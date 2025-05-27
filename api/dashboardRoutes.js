const express = require("express");
const DashboardOverview = require("../models/DashboardOverview");

const router = express.Router();

router.get("/analytics", async (req, res) => {
  try {
    const User = require("../models/User");
    const Tier = require("../models/Tier");

    // Calculate total users
    const totalUsers = await User.countDocuments();

    // Calculate active users (daily, weekly, monthly)
    const now = Date.now();
    const dailyActiveUsers = await User.countDocuments({
      lastLogin: { $gte: new Date(now - 24 * 60 * 60 * 1000) },
    });
    const weeklyActiveUsers = await User.countDocuments({
      lastLogin: { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) },
    });
    const monthlyActiveUsers = await User.countDocuments({
      lastLogin: { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) },
    });

    // Calculate business types breakdown
    const businessTypesBreakdown = await User.aggregate([
      { $group: { _id: "$businessType", count: { $sum: 1 } } },
      {
        $lookup: {
          from: "businesstypes",
          localField: "_id",
          foreignField: "_id",
          as: "businessTypeDetails",
        },
      },
      { $unwind: "$businessTypeDetails" },
      { $project: { businessType: "$businessTypeDetails.name", count: 1 } },
    ]);

    // Calculate AI usage metrics (queries used per user and per tier)
    const aiUsageMetrics = await User.aggregate([
      {
        $lookup: {
          from: "tiers",
          localField: "tier",
          foreignField: "_id",
          as: "tierDetails",
        },
      },
      { $unwind: "$tierDetails" },
      {
        $group: {
          _id: { user: "$_id", tier: "$tierDetails.name" },
          queriesUsed: { $sum: "$queryCount" },
        },
      },
      {
        $project: {
          user: "$_id.user",
          tier: "$_id.tier",
          queriesUsed: 1,
        },
      },
    ]);

    res.json({
      userAnalytics: {
        totalUsers,
        activeUsers: {
          daily: dailyActiveUsers,
          weekly: weeklyActiveUsers,
          monthly: monthlyActiveUsers,
        },
        businessTypesBreakdown,
      },
      aiUsageMetrics,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error generating analytics data.", error });
  }
});

module.exports = router;
