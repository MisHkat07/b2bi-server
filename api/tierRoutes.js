const express = require("express");
const router = express.Router();
const Tier = require("../models/Tier");
const { authMiddleware } = require("./user");

// Only admins can manage tiers
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

// Create Tier
router.post("/admin/tiers", async (req, res) => {
  try {
    const tier = new Tier(req.body);
    await tier.save();
    res.status(201).json({ message: "Tier created", tier });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to create tier", error: error.message });
  }
});

// Get all Tiers
router.get("/admin/tiers",  async (req, res) => {
  try {
    const tiers = await Tier.find();
    res.json({ tiers });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch tiers", error: error.message });
  }
});

// Get Tier by ID
router.get("/admin/tiers/:id",  async (req, res) => {
  try {
    const tier = await Tier.findById(req.params.id);
    if (!tier) return res.status(404).json({ message: "Tier not found" });
    res.json({ tier });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch tier", error: error.message });
  }
});

// Update Tier
router.put("/admin/tiers/:id",  async (req, res) => {
  try {
    const tier = await Tier.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!tier) return res.status(404).json({ message: "Tier not found" });
    res.json({ message: "Tier updated", tier });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to update tier", error: error.message });
  }
});

// Delete Tier
router.delete(
  "/admin/tiers/:id",
  async (req, res) => {
    try {
      const tier = await Tier.findByIdAndDelete(req.params.id);
      if (!tier) return res.status(404).json({ message: "Tier not found" });
      res.json({ message: "Tier deleted" });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to delete tier", error: error.message });
    }
  }
);

module.exports = router;
