const mongoose = require("mongoose");

const Businesses = new mongoose.Schema(
  {
    name: String,
    id: String,
    types: [String],
    businessStatus: String,
    displayName: {
      text: String,
      languageCode: String,
    },
    nationalPhoneNumber: String,
    internationalPhoneNumber: String,
    websiteUri: String,
    googleMapsUri: String,
    formattedAddress: String,
    rating: Number,
    userRatingCount: Number,
    reviews: [mongoose.Schema.Types.Mixed],
    primaryType: String,
    // emails: [
    //   {
    //     email: String,
    //     domain: String,
    //   },
    // ],
    emails: [String],
    linkedIn: String,
    gptInsights: String,
    websiteInfo: {
      websiteStatus: String,
      hasSSL: Boolean,
      pageSpeed: {
        performance: Number,
        lcp: String,
        fcp: String,
        tti: String,
        load_time: Number,
      },
    },
    searchText: String,
  },

  { timestamps: true }
);

module.exports = mongoose.model("Businesses", Businesses);
