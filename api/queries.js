import mongoose from "mongoose";
import Query from "../models/Query.js";

let conn = null;
async function connectToDatabase() {
  if (conn == null) {
    conn = await mongoose.connect(process.env.MONGO_URI);
  }
  return conn;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }
  await connectToDatabase();
  try {
    const queries = await Query.find();
    res.status(200).json(queries);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch queries", error: error.toString() });
  }
}
