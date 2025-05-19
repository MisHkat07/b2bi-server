const mongoose = require("mongoose");

const TierSchema = new mongoose.Schema({
  name: { type: String, enum: ["free", "pro", "enterprise"], required: true },
  monthlyQueries: { type: Number, required: true },
  features: {
    chromeExtension: { type: Boolean, default: false },
    bulkUpload: { type: Boolean, default: false },
  },
});

module.exports = mongoose.model("Tier", TierSchema);
