const mongoose = require("mongoose");

const QuerySchema = new mongoose.Schema(
  {
    searchText: { type: String, required: true },
    results: [{ type: mongoose.Schema.Types.ObjectId, ref: "Businesses" }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Query", QuerySchema);
