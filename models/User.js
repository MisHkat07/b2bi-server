const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["user", "moderator", "admin", "superadmin"],
      default: "user",
    },
    tier: { type: mongoose.Schema.Types.ObjectId, ref: "Tier" },
    businessType: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessType" },
    lastLogin: Date,
    queryCount: { type: Number, default: 0 },
    serviceAreas: [String],
    tierChangeHistory: [
      {
        previousTier: { type: mongoose.Schema.Types.ObjectId, ref: "Tier" },
        newTier: { type: mongoose.Schema.Types.ObjectId, ref: "Tier" },
        changedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

UserSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", UserSchema);
