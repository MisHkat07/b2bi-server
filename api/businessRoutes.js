const express = require("express");
const router = express.Router();
const Businesses = require("../models/Businesses");
const Query = require("../models/Query");
const axios = require("axios");
const { scrapeWebsiteForInfo } = require("../utils/scraper");
require("dotenv").config();
const userRoutes = require("./user");
const roleRoutes = require("./roles");
const User = require("../models/User");
router.use("/user", userRoutes.userRouter);
router.use("/roles", roleRoutes);

// Utility to batch process with limited concurrency and retries
async function batchProcessWithConcurrencyLimit(
  items,
  handler,
  concurrency = 1,
  retries = 2
) {
  const results = [];
  let currentIndex = 0;

  async function processNext() {
    if (currentIndex >= items.length) return;
    const index = currentIndex++;
    let attempt = 0;

    while (attempt <= retries) {
      try {
        results[index] = await handler(items[index]);
        break;
      } catch (err) {
        attempt++;
        if (attempt > retries) {
          console.error(`Failed to process item at index ${index}:`, err);
          results[index] = {
            ...items[index],
            scrapeError: err.message || "Failed after retries",
          };
        }
      }
    }

    await processNext(); // continue next
  }

  const workers = Array(Math.min(concurrency, items.length))
    .fill(0)
    .map(processNext);
  await Promise.all(workers);
  return results;
}

// @desc    Search businesses via Google Places and enrich with scraping + GPT
router.post("/search", async (req, res) => {
  const { searchText } = req.body;
  if (!searchText) {
    return res.status(400).json({ message: "Missing searchText" });
  }

  // Get current user from JWT (cookie or header)
  let userBusinessTypeId = null;
  let userId = null;
  let userServiceAreas = [];
  let userBusinessTypeName = null;
  // if (req.user && req.user.id) {
  //   userId = req.user.id;
  // } else if (req.cookies && req.cookies.accessToken) {
  //   try {
  //     const jwt = require("jsonwebtoken");
  //     const SECRET = process.env.JWT_SECRET || "random_secret_key";
  //     const decoded = jwt.verify(req.cookies.accessToken, SECRET);
  //     if (typeof decoded === "object" && decoded.id) {
  //       userId = decoded.id;
  //     }
  //   } catch (e) {}
  // }
  // if (userId) {
  //   const userDoc = await User.findById(userId).populate("businessType").lean();
  //   if (userDoc) {
  //     if (
  //       userDoc.businessType &&
  //       typeof userDoc.businessType === "object" &&
  //       userDoc.businessType.name
  //     ) {
  //       userBusinessTypeId = userDoc.businessType._id;
  //       userBusinessTypeName = userDoc.businessType.name;
  //     } else if (userDoc.businessType) {
  //       userBusinessTypeId = userDoc.businessType;
  //     }
  //     if (Array.isArray(userDoc.serviceAreas)) {
  //       userServiceAreas = userDoc.serviceAreas;
  //     }
  //   }
  // }

  let queryDoc = await Query.findOne({ searchText });
  if (queryDoc) {
    queryDoc.searchCount = (queryDoc.searchCount || 0) + 1;
    await queryDoc.save();

    // Always return cached results from DB if query exists
    const businesses = await Businesses.find({
      _id: { $in: queryDoc.results },
    });
    // Optionally, sort businesses by generalScore if needed
    businesses.sort(
      (a, b) =>
        (b.score?.generalParameters || 0) - (a.score?.generalParameters || 0)
    );
    return res.status(200).json({
      query: searchText,
      results: businesses,
      resultCount: queryDoc.resultCount || businesses.length,
      cached: true,
    });
  }

  // Only make a single call to Google Places API, no pagination/nextPageToken logic
  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const url = "https://places.googleapis.com/v1/places:searchText";
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "*",
    };

    // Fetch all pages from Google Places until nextPageToken is null
    let allPlaces = [];
    let nextPageToken = null;
    let firstRequest = true;
    let lastPageToken = null;

    const body = { textQuery: searchText };
    const response = await axios.post(url, body, { headers });
    const places = response.data.places || [];
    allPlaces = allPlaces.concat(places);

    // do {
    //   const body = { textQuery: searchText };
    //   if (!firstRequest && nextPageToken) {
    //     body.pageToken = nextPageToken;
    //   }
    //   const response = await axios.post(url, body, { headers });
    //   const places = response.data.places || [];
    //   allPlaces = allPlaces.concat(places);
    //   nextPageToken = response.data.nextPageToken;
    //   if (nextPageToken) lastPageToken = nextPageToken;
    //   firstRequest = false;
    //   if (nextPageToken) {
    //     await new Promise((r) => setTimeout(r, 2000)); // Google API requires delay between page fetches
    //   }
    // } while (nextPageToken);

    // Enrich each place with scraped data
    const enrichedResults = await batchProcessWithConcurrencyLimit(
      allPlaces,
      async (placeData) => {
        const baseInfo = {
          name: placeData.displayName?.text,
          id: placeData.id,
          types: placeData.types,
          businessStatus: placeData.businessStatus,
          displayName: placeData.displayName,
          nationalPhoneNumber: placeData.nationalPhoneNumber,
          internationalPhoneNumber: placeData.internationalPhoneNumber,
          websiteUri: placeData.websiteUri,
          googleMapsUri: placeData.googleMapsUri,
          formattedAddress: placeData.formattedAddress,
          rating: placeData.rating,
          userRatingCount: placeData.userRatingCount,
          reviews: placeData.reviews,
          primaryType: placeData.primaryType,
        };

        let websiteInfo = {};

        websiteInfo = await scrapeWebsiteForInfo(
          baseInfo?.websiteUri,
          baseInfo.name,
          baseInfo.types,
          baseInfo.formattedAddress,
          userBusinessTypeId,
          userServiceAreas,
          userBusinessTypeName
        );

        return { ...baseInfo, ...websiteInfo };
      },
      5,
      2
    );
    // Save to DB
    const savedResults = [];

    for (const result of enrichedResults) {
      // Calculate generalParameters score
      let generalScore = 0;
      const generalCriteriaDetails = [];
      // 1. Website missing
      if (!result.websiteUri) {
        generalScore += 30;
        generalCriteriaDetails.push({
          parameter: "Website missing",
          value: false,
          points: 30,
        });
      }
      // 2. Google Reviews < 5
      if (typeof result.rating === "number" && result.rating < 4.5) {
        generalScore += 10;
        generalCriteriaDetails.push({
          parameter: "Google Reviews < 4.5",
          value: result.rating,
          points: 10,
        });
      }
      // 3. Domain is Gmail/Yahoo
      if (Array.isArray(result.emails) && result.emails.length > 0) {
        const emailDomains = result.emails.map((e) =>
          typeof e === "string" ? e.split("@")[1] : e.domain
        );
        if (
          emailDomains.some((domain) => /gmail\.com|yahoo\.com/i.test(domain))
        ) {
          generalScore += 15;
          generalCriteriaDetails.push({
            parameter: "Domain is Gmail/Yahoo",
            value: emailDomains,
            points: 15,
          });
        }
      }
      // 4. PageSpeed performance < 40
      if (
        result.pageSpeed &&
        typeof result.pageSpeed.performance === "number" &&
        result.pageSpeed.performance < 40
      ) {
        generalScore += 25;
        generalCriteriaDetails.push({
          parameter: "PageSpeed performance < 40",
          value: result.pageSpeed.performance,
          points: 25,
        });
      }
      // 5. Business registered < 2 years (from gptInsights.foundingYear)
      let nowYear = new Date().getFullYear();
      let foundingYear = null;
      if (
        result?.gptInsights &&
        result.gptInsights.company &&
        result.gptInsights.company.foundingYear
      ) {
        foundingYear = parseInt(result.gptInsights.company.foundingYear);
      }
      if (foundingYear && nowYear - foundingYear < 2) {
        generalScore += 20;
        generalCriteriaDetails.push({
          parameter: "Business registered < 2 years",
          value: foundingYear,
          points: 20,
        });
      }

      if (result.hasSSL && result.hasSSL !== true) {
        generalScore += 10; // Add points for missing SSL
        generalCriteriaDetails.push({
          parameter: "No SSL on site",
          value: false,
          points: 10,
        });
      }

      // Adjusted scoring logic to ensure points are added for missing SSL and unavailable website
      if (result.websiteStatus && result.websiteStatus === "Unavailable") {
        generalScore += 25; // Add points for website being unavailable
        generalCriteriaDetails.push({
          parameter: "Website unavailable",
          value: result.websiteStatus,
          points: 25,
        });
      }

      // Calculate as percentage (max possible: 85)
      const maxScore = 85;
      const generalScorePercent = Math.round((generalScore / maxScore) * 100);

      // Calculate marketingParameters score
      let marketingScore = 0;
      const marketingCriteriaDetails = [];
      // 1. Website unavailable

      // 2. Analyze gptInsights publicPosts/JobPosts
      if (result.gptInsights && result.gptInsights["publicPosts/JobPosts"]) {
        const posts = result.gptInsights["publicPosts/JobPosts"];
        if (Array.isArray(posts)) {
          for (const post of posts) {
            const content = (post.content || "").toLowerCase();
            if (content.includes("web developer")) {
              marketingScore += 50;
              marketingCriteriaDetails.push({
                parameter: "Job post: web developer",
                value: post.content,
                points: 50,
              });
            }
            if (content.includes("new store opening")) {
              marketingScore += 30;
              marketingCriteriaDetails.push({
                parameter: "Job post: new store opening",
                value: post.content,
                points: 30,
              });
            }
            if (content.includes("designer")) {
              marketingScore += 40;
              marketingCriteriaDetails.push({
                parameter: "Job post: designer",
                value: post.content,
                points: 40,
              });
            }
            if (
              content.includes("new product") ||
              content.includes("launching")
            ) {
              marketingScore += 40;
              marketingCriteriaDetails.push({
                parameter: "Job post: new product/launching",
                value: post.content,
                points: 40,
              });
            }
            if (
              content.includes("marketing role") ||
              content.includes("marketing manager") ||
              content.includes("marketing managers") ||
              content.includes("hiring for marketing")
            ) {
              marketingScore += 35;
              marketingCriteriaDetails.push({
                parameter: "Job post: marketing role/manager",
                value: post.content,
                points: 35,
              });
            }
          }
        }
      }
      // Calculate as percentage (max possible: 190)
      const maxMarketingScore = 190;
      const marketingScorePercent = Math.round(
        (marketingScore / maxMarketingScore) * 100
      );

      const newDoc = new Businesses({
        name: result.name,
        id: result.id,
        types: result.types,
        businessStatus: result.businessStatus,
        displayName: result.displayName,
        nationalPhoneNumber: result.nationalPhoneNumber,
        internationalPhoneNumber: result.internationalPhoneNumber,
        websiteUri: result.websiteUri,
        googleMapsUri: result.googleMapsUri,
        formattedAddress: result.formattedAddress,
        rating: result.rating,
        userRatingCount: result.userRatingCount,
        reviews: result.reviews,
        primaryType: result.primaryType,
        emails: result?.emails || [],
        linkedIn: result.linkedIn,
        gptInsights: result.gptInsights ? result.gptInsights : {},
        websiteInfo: {
          hasSSL: result.hasSSL,
          websiteStatus: result.websiteStatus,
          pageSpeed: result.pageSpeed || {},
        },
        searchText,
        score: {
          generalParameters: generalScorePercent,
          marketingParameters: marketingScorePercent,
          generalCriteriaDetails,
          marketingCriteriaDetails,
        },
      });

      await newDoc.save();
      savedResults.push({
        doc: newDoc,
        generalScore: newDoc.score.generalParameters,
      });
    }

    // Sort savedResults by generalScore descending
    savedResults.sort((a, b) => b.generalScore - a.generalScore);
    // Extract only the document objects for saving in Query
    const sortedDocs = savedResults.map((item) => item.doc);

    // Save search metadata
    if (!queryDoc) {
      queryDoc = new Query({
        searchText,
        results: sortedDocs.map((doc) => doc._id),
        searchCount: 1,
        resultCount: sortedDocs.length, // Save the number of results
      });
    } else {
      // Append new results to existing ones, then sort all by generalScore
      const allDocs = [
        ...queryDoc.results,
        ...sortedDocs.map((doc) => doc._id),
      ];
      // Fetch all docs for sorting
      const allBusinessDocs = await Businesses.find({ _id: { $in: allDocs } });
      allBusinessDocs.sort(
        (a, b) =>
          (b.score?.generalParameters || 0) - (a.score?.generalParameters || 0)
      );
      queryDoc.results = allBusinessDocs.map((doc) => doc._id);
      queryDoc.searchCount = (queryDoc.searchCount || 0) + 1;
      queryDoc.resultCount = allBusinessDocs.length;
    }

    await queryDoc.save();

    res.status(201).json({ query: searchText, results: savedResults });
  } catch (error) {
    console.error("Search or scrape failed:", error);
    res.status(500).json({
      message: "Error during business search and enrichment",
      error: error.toString(),
    });
  }
});

// @desc    Get all businesses from the database
router.get("/businesses", async (req, res) => {
  try {
    const businesses = await Businesses.find();
    res.status(200).json(businesses);
  } catch (error) {
    console.error("Failed to fetch businesses:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch businesses", error: error.toString() });
  }
});

// @desc    Get a single business by its id
router.get("/businesses/:id", async (req, res) => {
  try {
    const business = await Businesses.findById(req.params.id);
    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }
    res.status(200).json(business);
  } catch (error) {
    console.error("Failed to fetch business:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch business", error: error.toString() });
  }
});

// @desc    Get all queries from the database
router.get("/queries", async (req, res) => {
  try {
    const queries = await Query.find();
    res.status(200).json(queries);
  } catch (error) {
    console.error("Failed to fetch queries:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch queries", error: error.toString() });
  }
});

// @desc    Get a single query and its results by query id
router.get("/queries/:id", async (req, res) => {
  try {
    const queryDoc = await Query.findById(req.params.id).populate("results");
    if (!queryDoc) {
      return res.status(404).json({ message: "Query not found" });
    }
    res.status(200).json(queryDoc);
  } catch (error) {
    console.error("Failed to fetch query:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch query", error: error.toString() });
  }
});

module.exports = router;
