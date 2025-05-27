const mongoose = require("mongoose");

const TierSchema = new mongoose.Schema({
  name: { type: String, unique: true }, 
  maxQueriesPerMonth: { type: Number },
  features: [String], 
  priorityLevel: { type: Number }, 
  dataSources: [String], 
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Tier", TierSchema);
