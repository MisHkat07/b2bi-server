import mongoose from "mongoose";
import { scrapeWebsiteForInfo } from "../utils/scraper.js"; // Adjusted path to correct location
import Businesses from "../models/Businesses.js"; // Adjusted path to match the correct location
import Query from "../models/Query.js"; // Adjusted path to match the correct location
import axios from "axios";

let conn = null;
async function connectToDatabase() {
  if (conn == null) {
    conn = await mongoose.connect(process.env.MONGO_URI);
  }
  return conn;
}

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
          results[index] = {
            ...items[index],
            scrapeError: err.message || "Failed after retries",
          };
        }
      }
    }
    await processNext();
  }
  const workers = Array(Math.min(concurrency, items.length))
    .fill(0)
    .map(processNext);
  await Promise.all(workers);
  return results;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }
  const { searchText, count } = req.body;
  if (!searchText) {
    return res.status(400).json({ message: "Missing searchText" });
  }
  await connectToDatabase();
  const maxResults = Number.isInteger(count) && count > 0 ? count : 2;
  try {
    // Check if searchText exists in Query collection
    const existingQuery = await Query.findOne({ searchText }).populate(
      "results"
    );
    if (
      existingQuery &&
      existingQuery.results &&
      existingQuery.results.length > 0
    ) {
      // Return businesses from DB
      return res
        .status(200)
        .json({ query: searchText, results: existingQuery.results });
    }
    // If not found, fetch from Google Places API and enrich
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
        await new Promise((r) => setTimeout(r, 2000));
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
      await newDoc.save();
      savedResults.push(newDoc);
    }
    // Save search metadata
    const queryRecord = new Query({
      searchText,
      results: savedResults.map((doc) => doc._id),
    });
    await queryRecord.save();
    res.status(201).json({ query: searchText, results: savedResults });
  } catch (error) {
    res.status(500).json({
      message: "Error during business search and enrichment",
      error: error.toString(),
    });
  }
}
