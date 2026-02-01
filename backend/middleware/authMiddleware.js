const jwt = require("jsonwebtoken");
const db = require("../config/db"); 

const protect = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(403).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 1. Check if user still exists and is NOT blocked
    const [rows] = await db.execute(
      "SELECT is_blocked, role FROM users WHERE user_id = ?", 
      [decoded.user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "User no longer exists" });
    }

    if (rows[0].is_blocked) {
      return res.status(403).json({ message: "Your account is blocked. Contact support." });
    }

    // 2. Attach user info to the request
    req.user = {
      user_id: decoded.user_id,
      role: rows[0].role
    };

    next();
  } catch (err) {
    res.status(401).json({ message: "Unauthorized or invalid token" });
  }
};

// Middleware for Admin-only routes
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: "Access denied: Admins only" });
  }
};

module.exports = { protect, admin };