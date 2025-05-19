const mongoose = require("mongoose");

const BusinessTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  subcategories: [{ type: String }],
  prompt: { type: String }, 
});

module.exports = mongoose.model("BusinessType", BusinessTypeSchema);
