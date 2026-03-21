
const jwt = require("jsonwebtoken");
const db = require("../config/db"); 

const protect = async (req, res, next) => {
  const activeSecret = process.env.JWT_SECRET; 
  const token = req.headers.authorization?.split(" ")[1];

  if (!activeSecret) {
    console.error("❌ ERROR: JWT_SECRET is missing from process.env!");
    return res.status(500).json({ message: "Internal server config error" });
  }

  if (!token) {
    return res.status(403).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, activeSecret);
    
    // Use .promise() if your db connection doesn't support top-level await directly
    const [rows] = await db.promise().execute(
      "SELECT is_blocked, role FROM users WHERE user_id = ?", 
      [decoded.user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "User no longer exists" });
    }

    if (rows[0].is_blocked) {
      return res.status(403).json({ message: "Your account is blocked." });
    }

    req.user = {
      user_id: decoded.user_id,
      role: rows[0].role
    };

    next();
  } catch (err) {
    console.error("❌ JWT Verification Failed:", err.message); 
    res.status(401).json({ message: "Unauthorized or invalid token", error: err.message });
  }
};

// 1️⃣ ADD THE ADMIN MIDDLEWARE BACK
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: "Access denied: Admins only" });
  }
};

// 2️⃣ EXPORT BOTH (This fixes the TypeError in routes)
module.exports = { protect, admin };
