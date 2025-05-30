const express = require("express");
const router = express.Router();
const BusinessType = require("../models/BusinessType");
const { authMiddleware } = require("./user");

// Only admins can manage business types
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

// Create BusinessType
router.post(
  "/admin/businesstypes",
  // authMiddleware,
  // adminOnly,
  async (req, res) => {
    try {
      const businessType = new BusinessType(req.body);
      await businessType.save();
      res.status(201).json({ message: "BusinessType created", businessType });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to create business type",
          error: error.message,
        });
    }
  }
);

// Get all BusinessTypes
router.get(
  "/admin/businesstypes",
  // authMiddleware,
  // adminOnly,
  async (req, res) => {
    try {
      const businessTypes = await BusinessType.find();
      res.json({ businessTypes });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to fetch business types",
          error: error.message,
        });
    }
  }
);

// Get BusinessType by ID
router.get(
  "/admin/businesstypes/:id",
  // authMiddleware,
  // adminOnly,
  async (req, res) => {
    try {
      const businessType = await BusinessType.findById(req.params.id);
      if (!businessType)
        return res.status(404).json({ message: "BusinessType not found" });
      res.json({ businessType });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to fetch business type",
          error: error.message,
        });
    }
  }
);

// Update BusinessType
router.put(
  "/admin/businesstypes/:id",
  // authMiddleware,
  // adminOnly,
  async (req, res) => {
    try {
      const businessType = await BusinessType.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true }
      );
      if (!businessType)
        return res.status(404).json({ message: "BusinessType not found" });
      res.json({ message: "BusinessType updated", businessType });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to update business type",
          error: error.message,
        });
    }
  }
);

// Delete BusinessType
router.delete(
  "/admin/businesstypes/:id",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const businessType = await BusinessType.findByIdAndDelete(req.params.id);
      if (!businessType)
        return res.status(404).json({ message: "BusinessType not found" });
      res.json({ message: "BusinessType deleted" });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Failed to delete business type",
          error: error.message,
        });
    }
  }
);

module.exports = router;
