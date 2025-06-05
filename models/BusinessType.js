const mongoose = require("mongoose");

const BusinessTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  subcategories: [
    {
      name: { type: String, required: true },
      prompt: [
        {
          content: { type: String, required: true },
          version: Number,
          model: { type: String, enum: ["gpt-4", "gpt-4o"], required: true },
          active: { type: Boolean, default: true },
        },
      ],
    },
  ],
  description: { type: String },
  prompt: [
    {
      content: { type: String, required: true },
      version: Number,
      model: { type: String, enum: ["gpt-4", "gpt-4o"], required: true },
      active: { type: Boolean, default: true },
    },
  ],
});

module.exports = mongoose.model("BusinessType", BusinessTypeSchema);
