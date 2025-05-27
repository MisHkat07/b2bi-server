const express = require("express");
const Feedback = require("../models/Feedback");
const Report = require("../models/Report");

const router = express.Router();

// POST /feedback - Submit user feedback
router.post("/feedback", async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) {
      return res
        .status(400)
        .json({ message: "User ID and feedback message are required." });
    }

    const feedback = new Feedback({ userId, message });
    await feedback.save();

    res.status(200).json({ message: "Feedback submitted successfully." });
  } catch (error) {
    res.status(500).json({ message: "Error submitting feedback.", error });
  }
});

// GET /feedback - Retrieve all feedback
router.get("/feedback", async (req, res) => {
  try {
    const feedbacks = await Feedback.find();
    res.status(200).json(feedbacks);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving feedback.", error });
  }
});

// POST /report - Submit a user report
router.post("/report", async (req, res) => {
  try {
    const { userId, issue } = req.body;
    if (!userId || !issue) {
      return res
        .status(400)
        .json({ message: "User ID and issue description are required." });
    }

    const report = new Report({ userId, issue });
    await report.save();

    res.status(200).json({ message: "Report submitted successfully." });
  } catch (error) {
    res.status(500).json({ message: "Error submitting report.", error });
  }
});

// GET /report - Retrieve all reports
router.get("/report", async (req, res) => {
  try {
    const reports = await Report.find();
    res.status(200).json(reports);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving reports.", error });
  }
});

module.exports = router;
