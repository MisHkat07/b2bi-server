const mongoose = require("mongoose");

const DashboardOverviewSchema = new mongoose.Schema({
  userAnalytics: {
    totalUsers: { type: Number, default: 0 },
    activeUsers: {
      daily: { type: Number, default: 0 },
      weekly: { type: Number, default: 0 },
      monthly: { type: Number, default: 0 },
    },
    businessTypesBreakdown: [
      {
        businessType: String,
        count: Number,
      },
    ],
  },
  aiUsageMetrics: [
    {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      tier: { type: mongoose.Schema.Types.ObjectId, ref: "Tier" },
      queriesUsed: Number,
    },
  ],
  queryLogs: [
    {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      queryText: String,
      timestamp: { type: Date, default: Date.now },
      success: Boolean,
      feedback: {
        type: String,
        enum: ["thumbs_up", "thumbs_down", null],
        default: null,
      },
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("DashboardOverview", DashboardOverviewSchema);
