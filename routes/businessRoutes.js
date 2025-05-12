const express = require("express");
const router = express.Router();
const Businesses = require("../models/Businesses");
const Query = require("../models/Query");
const axios = require("axios");
const { scrapeWebsiteForInfo } = require("../utils/scraper");
require("dotenv").config();

// Utility to batch process with limited concurrency and retries
async function batchProcessWithConcurrencyLimit(
  items,
  handler,
  concurrency = 3,
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
  const { searchText, count } = req.body;
  if (!searchText) {
    return res.status(400).json({ message: "Missing searchText" });
  }

  const maxResults = Number.isInteger(count) && count > 0 ? count : 2;

  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const url = "https://places.googleapis.com/v1/places:searchText";
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "*",
    };

    let allPlaces = [];
    let nextPageToken = null;
    let firstRequest = true;

    // Fetch all pages from Google Places
    do {
      const body = { textQuery: searchText };
      if (!firstRequest && nextPageToken) {
        body.pageToken = nextPageToken;
      }

      const response = await axios.post(url, body, { headers });
      const places = response.data.places || [];

      allPlaces = allPlaces.concat(places);
      nextPageToken = response.data.nextPageToken;
      firstRequest = false;

      if (nextPageToken && allPlaces.length < maxResults) {
        await new Promise((r) => setTimeout(r, 2000)); // delay before next page
      }
    } while (nextPageToken && allPlaces.length < maxResults);

    allPlaces = allPlaces.slice(0, maxResults);

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
        if (baseInfo.websiteUri) {
          websiteInfo = await scrapeWebsiteForInfo(baseInfo.websiteUri);
        }

        return { ...baseInfo, ...websiteInfo };
      },
      3,
      2
    );

    // Save to DB
    const savedResults = [];

    for (const result of enrichedResults) {
      // console.log(result.gptInsights);
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
        gptInsights: result?.gptInsights || "",
        websiteInfo: {
          hasSSL: result.hasSSL,
          websiteStatus: result.websiteStatus,
          pageSpeed: result.pageSpeed || {},
        },
        searchText,
      });
      console.log(result);
      await newDoc.save();
      savedResults.push(newDoc);
    }

    // Save search metadata only if not already present
    const existingQuery = await Query.findOne({ searchText });
    if (!existingQuery) {
      const queryRecord = new Query({
        searchText,
        results: savedResults.map((doc) => doc._id),
      });
      await queryRecord.save();
    }

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
    const query = await Query.findById(req.params.id).populate("results");
    if (!query) {
      return res.status(404).json({ message: "Query not found" });
    }
    res.status(200).json(query);
  } catch (error) {
    console.error("Failed to fetch query:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch query", error: error.toString() });
  }
});

module.exports = router;
