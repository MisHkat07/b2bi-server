const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("🔰 MongoDB connected"))
  .catch((err) => console.error("⚠️ MongoDB connection error:", err));

// Import Routes
const businessRoutes = require("../routes/businessRoutes");

// Use Routes
app.use("/api/google-place", businessRoutes);

app.get("/", (req, res) => {
  res.send("Welcome to the Google Place API");
});

// Start Server
app.listen(PORT, () => {
  console.log(`⏸️  Server running on port ${PORT}`);
});
