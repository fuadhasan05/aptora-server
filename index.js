require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SK_KEY);

const port = process.env.PORT || 3000;
const app = express();
// middleware
const allowedOrigins = [
  "http://localhost:5173",
  "https://aptora-25.web.app"
];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  const db = client.db("Aptora");
  const usersCollection = db.collection("users");
  const apartmentsCollection = db.collection("apertments");
  const agreementsCollection = db.collection("agreements");
  const announcementsCollection = db.collection("announcements");
  const couponsCollection = db.collection("coupons");
  const paymentsCollection = db.collection("payments");

  try {
    // Generate jwt token
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // save or update a user info in DB
    app.post("/user", async (req, res) => {
      const userData = req.body;
      userData.role = "user";
      userData.createdAt = new Date();
      userData.lastLogin = new Date();
      const query = { email: userData?.email };

      const existingUser = await usersCollection.findOne(query);

      if (!!existingUser) {
        const result = await usersCollection.updateOne(query, {
          $set: { lastLogin: new Date() },
        });
        return res.send(result);
      }

      const result = await usersCollection.insertOne(userData);
      res.send(result);
    });

    // get a user's role
    app.get("/user/role/:email",verifyToken,  async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }
      res.send({ role: user?.role });
    });

    // Get all users from DB
    app.get("/all-users", verifyToken,  async (req, res) => {
      console.log(req.user);
      const filter = {
        email: { $ne: req?.user?.email },
      };
      const result = await usersCollection.find(filter).toArray();
      res.send(result);
    });

    // Update user role
    app.patch("/user/role/update/:email", verifyToken,  async (req, res) => {
      const email = req.params.email;
      const { role, status } = req.body;
      const filter = { email: email };
      const updateDoc = {
        $set: {
          role,
          status: status || "varified",
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Get all apartments
    app.get("/apertments", async (req, res) => {
      const apartments = await apartmentsCollection.find().toArray();
      res.send(apartments);
    });

    // Get a single apartment by ID
    app.patch("/apartments/:apartmentNo", async (req, res) => {
      const apartmentNo = req.params.apartmentNo;
      const filter = { apartmentNo: apartmentNo };
      const updateDoc = {
        $set: {
          status: "rented",
        },
      };
      const result = await apartmentsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Get all announcements
    app.get("/announcements", async (req, res) => {
      const announcements = await announcementsCollection
        .find()
        .sort({ date: -1 })
        .toArray();
      res.send(announcements);
    });

    // Post an announcement
    app.post("/announcements", async (req, res) => {
      const announcement = req.body;
      announcement.date = new Date();
      const result = await announcementsCollection.insertOne(announcement);
      res.send(result);
    });

    // Create an agreement request
    app.post("/agreements", async (req, res) => {
      const { userEmail, apartmentNo } = req.body;
      // Check if user already applied for this apartment
      const existing = await agreementsCollection.findOne({
        userEmail,
        apartmentNo,
      });
      if (existing) {
        return res.json({
          success: false,
          message: "You have already applied for this apartment.",
        });
      }
      // Insert new agreement
      const result = await agreementsCollection.insertOne(req.body);
      res.json({ success: true, data: result });
    });

    // Get all agreement requests
    app.get("/agreements", verifyToken,  async (req, res) => {
      const agreements = await agreementsCollection.find().toArray();
      res.json(agreements);
    });

    // Accept an agreement request
    app.patch("/agreements/:id", verifyToken,  async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;
      const result = await agreementsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      res.json({ success: result.modifiedCount > 0 });
    });

    // Get user profile by email
    app.get("/my-profile", verifyToken,  async (req, res) => {
      const email = req.query.email;
      const profile = await agreementsCollection.findOne({ userEmail: email });
      res.send(profile);
    });

    // become a member request
    app.patch(
      "/become-member-request/:email",
      verifyToken,
      async (req, res) => {
        const email = req.params.email;
        const filter = { email: email };
        const updateDoc = {
          $set: {
            status: "requested",
          },
        };
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    // Get all coupons
    app.get("/coupons", async (req, res) => {
      try {
        const coupons = await couponsCollection.find().toArray();
        res.send(coupons);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch coupons" });
      }
    });

    // Add a new coupon
    app.post("/coupons", async (req, res) => {
      try {
        const couponData = req.body;
        couponData.date = new Date();
        const result = await couponsCollection.insertOne(couponData);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to add coupon" });
      }
    });

    // Get coupon by code
    app.get("/coupons/:code", async (req, res) => {
      const code = req.params.code.toUpperCase(); // Ensure uppercase
      try {
        const coupon = await couponsCollection.findOne({ code });
        if (!coupon) {
          return res.status(404).send({ message: "Coupon not found" });
        }
        res.send(coupon);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch coupon" });
      }
    });

    // Stripe Payment Intent
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { amount } = req.body;
        const convertedAmount = Math.round(amount / 110);
        const paymentIntent = await stripe.paymentIntents.create({
          amount: convertedAmount * 100, // amount in cents
          currency: "usd",
          automatic_payment_methods: { enabled: true },
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: error.message });
      }
    });

    // Save Payment Record
    app.post("/save-payment", async (req, res) => {
      try {
        const paymentData = req.body;
        paymentData.date = new Date();
        const result = await paymentsCollection.insertOne(paymentData);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to save payment" });
      }
    });

    // Get Payments by Email
    app.get("/api/payments", verifyToken,  async (req, res) => {
      try {
        const { email } = req.query;
        let filter = {};
        if (email) {
          filter.email = email;
        }
        // Convert cursor to array
        const payments = await paymentsCollection
          .find(filter)
          .sort({ date: -1 })
          .toArray();
        res.json(payments);
      } catch (err) {
        res.status(500).json({ message: err.message });
      }
    });

    // Admin Dashboard Stats
    app.get("/admin-stats",  async (req, res) => {
      try {
        const adminInfo = await usersCollection.findOne({ role: "admin" });

        if (!adminInfo) {
          return res.status(404).json({ message: "Admin not found" });
        }

        // Stats from DB
        const totalUsers = await usersCollection.countDocuments();
        const totalMembers = await usersCollection.countDocuments({
          role: "member",
        });
        const totalRooms = await apartmentsCollection.countDocuments();
        const availableRooms = await apartmentsCollection.countDocuments({
          status: { $ne: "rented" },
        });
        const unavailableRooms = totalRooms - availableRooms;

        res.json({
          admin: {
            name: adminInfo.name,
            email: adminInfo.email,
            image:
              adminInfo?.image || "https://i.ibb.co/7bQQYkX/default-avatar.png",
          },
          totalRooms,
          availableRooms,
          unavailableRooms,
          totalUsers,
          totalMembers,
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch admin stats" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Aptora Server..");
});

app.listen(port, () => {
  console.log(`Aptora is running on port ${port}`);
});
