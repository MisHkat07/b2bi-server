const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const SECRET = process.env.JWT_SECRET || "changeme_secret";

// Middleware for role-based authorization
function authorizeRoles(...roles) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, SECRET);
      req.user = decoded;
      if (!roles.includes(decoded.role)) {
        return res
          .status(403)
          .json({ message: "Forbidden: insufficient role" });
      }
      next();
    } catch (err) {
      res.status(401).json({ message: "Invalid token" });
    }
  };
}

// Example protected routes
router.get("/admin", authorizeRoles("admin", "superadmin"), (req, res) => {
  res.json({ message: "Welcome, admin or superadmin!", user: req.user });
});

router.get(
  "/moderator",
  authorizeRoles("moderator", "admin", "superadmin"),
  (req, res) => {
    res.json({ message: "Welcome, moderator or higher!", user: req.user });
  }
);

router.get("/superadmin", authorizeRoles("superadmin"), (req, res) => {
  res.json({ message: "Welcome, superadmin!", user: req.user });
});

module.exports = router;
