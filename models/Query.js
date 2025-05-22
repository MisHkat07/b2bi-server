const mongoose = require("mongoose");

// Add resultCount to QuerySchema
const QuerySchema = new mongoose.Schema(
  {
    searchText: { type: String, required: true },
    results: [{ type: mongoose.Schema.Types.ObjectId, ref: "Businesses" }],
    searchCount: { type: Number, default: 0 },
    resultCount: { type: Number, default: 0 }, // Add this line
  },
  { timestamps: true }
);

module.exports = mongoose.model("Query", QuerySchema);
