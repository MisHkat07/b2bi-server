const mongoose = require("mongoose");

const ReportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  issue: { type: String, required: true },
  status: { type: String, enum: ["open", "resolved"], default: "open" },
  reportedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Report", ReportSchema);