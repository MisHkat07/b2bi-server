const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Tier = require("../models/Tier");
const SECRET = process.env.JWT_SECRET || "random_secret_key";
const cookieParser = require("cookie-parser");

router.use(cookieParser());

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax", // Use the string literal 'lax' for compatibility
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function generateTokens(user) {
  const accessToken = jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: "15m" }
  );
  const refreshToken = jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: "7d" }
  );
  return { accessToken, refreshToken };
}

// Fix comparePassword for Mongoose Document
const getUserWithCompare = async (email) => {
  const user = await User.findOne({ email });
  if (!user) return null;
  // @ts-ignore
  user.comparePassword = User.schema.methods.comparePassword.bind(user);
  return user;
};

// Signup route
router.post("/signup", async (req, res) => {
  try {
    const { username, email, password, businessType, serviceAreas } = req.body;
    if (!username || !email || !password || !businessType) {
      return res
        .status(400)
        .json({ message: "All fields are required, including businessType" });
    }
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      return res.status(409).json({ message: "User already exists" });
    }
    // Fetch the 'free' tier
    const freeTier = await Tier.findOne({ name: "free" });
    if (!freeTier) {
      return res
        .status(500)
        .json({ message: "Free tier not found. Please contact support." });
    }
    // Optionally assign businessType and serviceAreas if provided
    const userData = { username, email, password, tier: freeTier._id };
    if (businessType) userData.businessType = businessType;
    if (serviceAreas && Array.isArray(serviceAreas))
      userData.serviceAreas = serviceAreas;
    const user = new User(userData);
    await user.save();
    const { accessToken, refreshToken } = generateTokens(user);
    res
      .cookie("accessToken", accessToken, {
        ...cookieOptions,
        maxAge: 15 * 60 * 1000,
      })
      .cookie("refreshToken", refreshToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .status(201)
      .json({
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          tier: user.tier,
          serviceAreas: user.serviceAreas,
        },
      });
  } catch (err) {
    res.status(500).json({ message: "Signup failed", error: err.message });
  }
});

// Login route
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }
    const user = await getUserWithCompare(email);
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const isMatch = await /** @type {any} */ (user).comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    // Update lastLogin and increment queryCount on login
    user.lastLogin = new Date();
    user.queryCount = (user.queryCount || 0) + 1;
    await user.save();
    const { accessToken, refreshToken } = generateTokens(user);
    res
      .cookie("accessToken", accessToken, {
        ...cookieOptions,
        maxAge: 15 * 60 * 1000,
      })
      .cookie("refreshToken", refreshToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .status(200)
      .json({
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      });
  } catch (err) {
    res.status(500).json({ message: "Login failed", error: err.message });
  }
});

// Refresh token route
router.post("/refresh-token", (req, res) => {
  const { refreshToken } = req.cookies;
  if (!refreshToken) {
    return res.status(401).json({ message: "No refresh token provided" });
  }
  try {
    const decoded = jwt.verify(refreshToken, SECRET);
    if (
      typeof decoded !== "object" ||
      !decoded.id ||
      !decoded.username ||
      !decoded.role
    ) {
      return res.status(401).json({ message: "Invalid refresh token" });
    }
    const accessToken = jwt.sign(
      { id: decoded.id, username: decoded.username, role: decoded.role },
      SECRET,
      { expiresIn: "15m" }
    );
    res
      .cookie("accessToken", accessToken, {
        ...cookieOptions,
        maxAge: 15 * 60 * 1000,
      })
      .status(200)
      .json({ message: "Token refreshed" });
  } catch (err) {
    res.status(401).json({ message: "Invalid refresh token" });
  }
});

// Logout route
router.post("/logout", (req, res) => {
  res
    .clearCookie("accessToken")
    .clearCookie("refreshToken")
    .status(200)
    .json({ message: "Logged out successfully." });
});

// Auth middleware for cookie-based JWT
function authMiddleware(req, res, next) {
  const token = req.cookies.accessToken;
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }
  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
}

// Middleware for admin-only access
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

// Admin: Create user
router.post("/admin/users", authMiddleware, adminOnly, async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      businessType,
      serviceAreas,
      role,
      tier,
    } = req.body;
    if (!username || !email || !password || !businessType) {
      return res
        .status(400)
        .json({ message: "All fields are required, including businessType" });
    }
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      return res.status(409).json({ message: "User already exists" });
    }
    const userTier = tier ? tier : (await Tier.findOne({ name: "free" }))._id;
    const userData = {
      username,
      email,
      password,
      businessType,
      tier: userTier,
      role: role || "user",
    };
    if (serviceAreas && Array.isArray(serviceAreas))
      userData.serviceAreas = serviceAreas;
    const user = new User(userData);
    await user.save();
    res.status(201).json({ message: "User created", user });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Admin user creation failed", error: err.message });
  }
});

// Admin: Update user
router.put("/admin/users/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    if (updates.password) delete updates.password; // Prevent password change here
    const user = await User.findByIdAndUpdate(id, updates, { new: true });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User updated", user });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Admin user update failed", error: error.message });
  }
});

// Admin: Delete user
router.delete(
  "/admin/users/:id",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const user = await User.findByIdAndDelete(id);
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json({ message: "User deleted" });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Admin user deletion failed", error: error.message });
    }
  }
);

// Admin: Get all users
router.get("/admin/users", authMiddleware, adminOnly, async (req, res) => {
  try {
    const users = await User.find().select("-password"); // Exclude password field
    res.json({ users });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch users", error: error.message });
  }
});

module.exports = { userRouter: router, authMiddleware };
