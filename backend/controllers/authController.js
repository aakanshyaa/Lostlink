const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { googleClient, GOOGLE_CLIENT_ID } = require("../config/google");
const sendWelcomeEmail = require("../utils/sendEmail");


// Helper to get secret dynamically (prevents 'undefined' on startup)
const getSecret = () => process.env.JWT_SECRET;

/* REGISTER */
exports.register = async (req, res) => {
  try {
    const { full_name, email, password } = req.body;
    if (!full_name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const [existing] = await db.promise().query("SELECT * FROM users WHERE email = ?", [email]);
    if (existing.length) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = `INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)`;
    await db.promise().query(sql, [full_name, email, hashedPassword]);

    sendWelcomeEmail(email, full_name).catch(err => 
      console.error("Background Email Error:", err)
    );

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
    const [users] = await db.promise().query("SELECT * FROM users WHERE email = ?", [email]);

    if (users.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = users[0];
    if (user.is_blocked) {
      return res.status(403).json({ message: "Your account is blocked. Please contact support." });
    }

    if (user.password === "GOOGLE_USER") {
      return res.status(400).json({ message: "Please use Google Login for this account" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { user_id: user.user_id, role: user.role }, 
      getSecret(), 
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email,
        role: user.role
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

    const { email, name, picture } = ticket.getPayload();
    const [users] = await db.promise().query("SELECT * FROM users WHERE email = ?", [email]);
    let user = users[0];

    if (user && user.is_blocked) {
       return res.status(403).json({ message: "Your account is blocked." });
    }

    // Check if it's a NEW user
    if (!user) {
      const [result] = await db.promise().query(
        "INSERT INTO users (full_name, email, password, role, profile_image) VALUES (?, ?, ?, ?, ?)",
        [name, email, "GOOGLE_USER", "user", picture] 
      );
      
      user = { user_id: result.insertId, full_name: name, email: email, role: "user" };

      // --- TRIGGER EMAIL FOR NEW GOOGLE USER ---
      sendWelcomeEmail(email, name).catch(err => 
        console.error("Background Google Welcome Email Error:", err)
      );
    }

    const jwtToken = jwt.sign(
      { user_id: user.user_id, role: user.role || "user" }, 
      getSecret(), 
      { expiresIn: "7d" }
    );

    res.json({ 
      token: jwtToken, 
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email,
        role: user.role || "user"
      } 
    });
  } catch (err) {
    console.error("Google Auth Error:", err);
    res.status(401).json({ message: "Google login failed" });
  }
};

/* GET CURRENT USER DATA */
exports.getMe = async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      "SELECT user_id, full_name, email, profile_image, role FROM users WHERE user_id = ?", 
      [req.user.user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error fetching user data" });
  }
};

/* UPDATE PROFILE */
exports.updateProfile = async (req, res) => {
  try {
    const { full_name, email } = req.body;
    let query = "UPDATE users SET full_name = ?, email = ? WHERE user_id = ?";
    let params = [full_name, email, req.user.user_id];

    if (req.file) {
      const imagePath = `/uploads/${req.file.filename}`;
      query = "UPDATE users SET full_name = ?, email = ?, profile_image = ? WHERE user_id = ?";
      params = [full_name, email, imagePath, req.user.user_id];
    }

    await db.promise().query(query, params);
    
    // Fetch updated user to return clean data
    const [updated] = await db.promise().query("SELECT * FROM users WHERE user_id = ?", [req.user.user_id]);

    res.json({ 
      message: "Profile updated successfully",
      user: updated[0]
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
    if (!password) return res.status(400).json({ message: "Password is required" });

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.promise().query(
      "UPDATE users SET password = ? WHERE user_id = ?",
      [hashedPassword, req.user.user_id]
    );

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error updating password" });
  }
};