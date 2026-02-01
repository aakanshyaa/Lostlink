const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { googleClient, GOOGLE_CLIENT_ID } = require("../config/google");

// Use environment variables for secrets
const JWT_SECRET = process.env.JWT_SECRET || "lostlink_secret_key";

/* REGISTER */
exports.register = async (req, res) => {
  try {
    const { full_name, email, password } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check if user already exists
    const [existing] = await db.promise().query("SELECT * FROM users WHERE email = ?", [email]);
    if (existing.length) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Encrypt password
    const hashedPassword = await bcrypt.hash(password, 10);

    // FIXED: SQL had 4 '?' but only 3 values were passed
    const sql = `INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)`;

    await db.promise().query(sql, [full_name, email, hashedPassword]);

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error during registration" });
  }
};

/* LOGIN */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const sql = "SELECT * FROM users WHERE email = ?";
    const [users] = await db.promise().query(sql, [email]);

    if (users.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = users[0];

    if (user.is_blocked) {
  return res.status(403).json({ message: "Your account is blocked. Please contact support." });
}

    // Handle Google users trying to login via standard form
    if (user.password === "GOOGLE_USER") {
      return res.status(400).json({ message: "Please use Google Login for this account" });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Create token
    // const token = jwt.sign(
    //   { user_id: user.user_id },
    //   JWT_SECRET,
    //   { expiresIn: "7d" }
    // );
    const token = jwt.sign(
  { user_id: user.user_id, role: user.role }, // Include role here
  JWT_SECRET,
  { expiresIn: "7d" }
);

    res.json({
      message: "Login successful",
      token,
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error during login" });
  }
};

/* GOOGLE LOGIN */
exports.googleLogin = async (req, res) => {
  try {
    const { token } = req.body;

    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });

    console.log(ticket.getPayload());
    const { email, name } = ticket.getPayload();

    const [users] = await db.promise().query("SELECT * FROM users WHERE email = ?", [email]);
    let user = users[0];


    if (user && user.is_blocked) {
       return res.status(403).json({ message: "Your account is blocked." });
    }

    if (!user) {
      const [result] = await db.promise().query(
        "INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)",
        [name, email, "GOOGLE_USER"]
      );

      user = { user_id: result.insertId, full_name: name, email };
    }

    const jwtToken = jwt.sign({ user_id: user.user_id , role: user.role}, JWT_SECRET, { expiresIn: "7d" });

    res.json({ token: jwtToken, user });
  } catch (err) {
    console.error("Google Auth Error:", err.response?.data || err.message || err);
    res.status(401).json({ message: "Google login failed" });
  }
};


/* GET CURRENT USER DATA */
exports.getMe = async (req, res) => {
  try {
    // UPDATED: Added profile_image to the SELECT statement
    // const [rows] = await db.promise().query(
    //   "SELECT user_id, full_name, email, profile_image FROM users WHERE user_id = ?", 
    //   [req.user.user_id]
    // );
    const [rows] = await db.promise().query(
  "SELECT user_id, full_name, email, profile_image, role FROM users WHERE user_id = ?", 
  [req.user.user_id]
);

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // This now sends the full_name, email, and profile_image to React
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error fetching user data" });
  }
};


exports.updateProfile = async (req, res) => {
  try {
    const { full_name, email } = req.body;
    let query = "UPDATE users SET full_name = ?, email = ? WHERE user_id = ?";
    let params = [full_name, email, req.user.user_id];

    // If a file was uploaded, update the image path too
    if (req.file) {
      const imagePath = `/uploads/${req.file.filename}`;
      query = "UPDATE users SET full_name = ?, email = ?, profile_image = ? WHERE user_id = ?";
      params = [full_name, email, imagePath, req.user.user_id];
    }

    await db.promise().query(query, params);
    res.json({ 
      message: "Profile updated successfully",
      profile_image: req.file ? `/uploads/${req.file.filename}` : null
     });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Update failed" });
  }
};


/* CHANGE PASSWORD */
exports.changePassword = async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password in database
    await db.promise().query(
      "UPDATE users SET password = ? WHERE user_id = ?",
      [hashedPassword, req.user.user_id]
    );

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Change Password Error:", err);
    res.status(500).json({ message: "Server error updating password" });
  }
};