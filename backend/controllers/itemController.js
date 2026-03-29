const db = require('../config/db');
const sendWelcomeEmail = require("../utils/sendEmail"); 
const nodemailer = require("nodemailer");

// POST A NEW ITEM (Lost or Found)
exports.postItem = async (req, res) => {
  try {
    
    const { type, item_name, category, description, location, latitude, longitude, date, phone } = req.body;
    const user_id = req.user.user_id;
    const image = req.file ? `/uploads/${req.file.filename}` : null;

    const table = type === 'lost' ? 'lost_items' : 'found_items';
    const dateCol = type === 'lost' ? 'lost_date' : 'found_date';

    
    const sql = `INSERT INTO ${table} 
      (user_id, item_name, category, description, location, latitude, longitude, phone, ${dateCol}, image) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    await db.promise().query(sql, [
      user_id, item_name, category, description, location, 
      latitude, longitude, phone, date, image
    ]);

    res.status(201).json({ message: "Item posted successfully" });
  } catch (err) {
    console.error("Post error:", err);
    res.status(500).json({ message: "Post failed", error: err.message });
  }
};

// GET UNIVERSAL FEED (With Filters + Pagination)
exports.getFeed = async (req, res) => {
  try {
    const {
      category,
      type,
      search,
      page = 1,
      limit = 9,
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let whereClauses = ["status = 'active'"];
    let whereParams = [];

    if (category && category !== "All") {
      whereClauses.push("category = ?");
      whereParams.push(category);
    }

    if (search) {
      whereClauses.push("(item_name LIKE ? OR location LIKE ? OR category LIKE ?)");
      whereParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereSql = whereClauses.join(" AND ");

    // Added latitude and longitude to the SELECT clauses
    const lostSql = `
      SELECT 
        lost_id AS id,
        item_name,
        category,
        location,
        latitude,
        longitude,
        image,
        created_at,
        'lost' AS type
      FROM lost_items
      WHERE ${whereSql}
    `;

    const foundSql = `
      SELECT 
        found_id AS id,
        item_name,
        category,
        location,
        latitude,
        longitude,
        image,
        created_at,
        'found' AS type
      FROM found_items
      WHERE ${whereSql}
    `;

    let finalSql = "";
    let finalParams = [];

    if (type === "lost") {
      finalSql = `${lostSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      finalParams = [...whereParams, limitNum, offset];
    } else if (type === "found") {
      finalSql = `${foundSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      finalParams = [...whereParams, limitNum, offset];
    } else {
      finalSql = `(${lostSql}) UNION ALL (${foundSql}) ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      finalParams = [...whereParams, ...whereParams, limitNum, offset];
    }

    const [items] = await db.promise().query(finalSql, finalParams);
    res.json(items);
  } catch (err) {
    console.error("Feed error:", err);
    res.status(500).json({ message: "Feed error", error: err.message });
  }
};

// GET ITEM DETAILS + OWNER INFO
exports.getItemDetails = async (req, res) => {
  try {
    const { type, id } = req.params;
    const table = type === 'lost' ? 'lost_items' : 'found_items';
    const idCol = type === 'lost' ? 'lost_id' : 'found_id';

    // 3. Updated SELECT to use t.phone (the item-specific contact) 
    // and fallback to u.phone if needed
    const sql = `
      SELECT t.*, u.full_name, u.email, 
      COALESCE(t.phone, u.phone) as phone
      FROM ${table} t 
      JOIN users u ON t.user_id = u.user_id 
      WHERE t.${idCol} = ?`;

    const [rows] = await db.promise().query(sql, [id]);
    if (rows.length === 0) return res.status(404).json({ message: "Item not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Details error:", err);
    res.status(500).json({ message: "Error fetching details" });
  }
};

// CREATE A REQUEST (The Handshake)
exports.createRequest = async (req, res) => {
  try {
    const { item_id, item_type, owner_id } = req.body;
    const requester_id = req.user.user_id;

    if (requester_id === owner_id) return res.status(400).json({ message: "You cannot request your own item" });

    const sql = `INSERT INTO item_requests (requester_id, owner_id, item_type, item_id) VALUES (?, ?, ?, ?)`;
    await db.promise().query(sql, [requester_id, owner_id, item_type, item_id]);
    res.status(201).json({ message: "Request sent to owner" });
  } catch (err) {
    res.status(500).json({ message: "Request failed" });
  }
};

// RESOLVE ITEM (Owner confirms item is returned/found)

exports.resolveItem = async (req, res) => {
  try {
    const { type, id } = req.body; // Expecting { type: 'lost', id: 123 }
    const user_id = req.user.user_id;

    // 1. Determine table and ID column dynamically
    const table = type === 'lost' ? 'lost_items' : 'found_items';
    const idCol = type === 'lost' ? 'lost_id' : 'found_id';

    // 2. Run the update with an ownership check
    const sql = `UPDATE ${table} SET status = 'resolved' WHERE ${idCol} = ? AND user_id = ?`;
    const [result] = await db.promise().query(sql, [id, user_id]);

    // 3. Check if anything actually changed (prevent unauthorized resolve)
    if (result.affectedRows === 0) {
      return res.status(403).json({ 
        message: "Action denied. You either don't own this post or it doesn't exist." 
      });
    }

    res.json({ message: "Item successfully marked as resolved!" });
  } catch (err) {
    console.error("Resolution error:", err);
    res.status(500).json({ message: "Resolution failed", error: err.message });
  }
};

exports.deleteItem = async (req, res) => {
  const { type, id } = req.params;
  const userId = req.user.user_id; // Using user_id from your middleware

  // 1. Determine table AND the correct ID column name
  const tableName = type === "lost" ? "lost_items" : "found_items";
  const idColumn = type === "lost" ? "lost_id" : "found_id";

  try {
    // 2. Check ownership using the correct column name
    const [item] = await db.promise().query(
      `SELECT user_id FROM ${tableName} WHERE ${idColumn} = ?`, 
      [id]
    );

    if (item.length === 0) {
      return res.status(404).json({ message: "Item not found." });
    }

    if (item[0].user_id !== userId) {
      return res.status(403).json({ message: "Unauthorized: You can only delete your own posts." });
    }

    // 3. Perform the deletion using the correct column name
    await db.promise().query(`DELETE FROM ${tableName} WHERE ${idColumn} = ?`, [id]);

    res.status(200).json({ message: "Post deleted successfully." });
  } catch (err) {
    console.error("Database Error:", err);
    res.status(500).json({ message: "Server error during deletion." });
  }
};

exports.getMyActivity = async (req, res) => {
  try {
    const user_id = req.user.user_id; // Get the ID from the decoded token

    const lostSql = `
      SELECT lost_id AS id, item_name, category, location, image, created_at, status, 'lost' AS type 
      FROM lost_items 
      WHERE user_id = ?`;

    const foundSql = `
      SELECT found_id AS id, item_name, category, location, image, created_at, status, 'found' AS type 
      FROM found_items 
      WHERE user_id = ?`;

    // Combine both using UNION so the user sees all their posts in one list
    const sql = `(${lostSql}) UNION ALL (${foundSql}) ORDER BY created_at DESC`;

    const [items] = await db.promise().query(sql, [user_id, user_id]);
    res.json(items);
  } catch (err) {
    console.error("Activity Fetch Error:", err);
    res.status(500).json({ message: "Failed to fetch activity log" });
  }
};


exports.notifyConnection = async (req, res) => {
  try {
    const { ownerEmail, ownerName, itemName, requesterName } = req.body;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER_FOR_MAIL,
        pass: process.env.EMAIL_PASS_FOR_MAIL,
      },
    });

    const mailOptions = {
      from: `"LostLink Connect" <${process.env.EMAIL_USER_FOR_MAIL}>`,
      to: ownerEmail,
      subject: `Inquiry: ${itemName}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #f0f0f0; border-radius: 10px;">
          <h2 style="color: #FF6B6B;">Hello ${ownerName},</h2>
          <p><strong>${requesterName}</strong> just clicked your WhatsApp contact link regarding <strong>"${itemName}"</strong>.</p>
          <p>Expect a message on WhatsApp shortly!</p>
          <br />
          <p style="font-size: 12px; color: #888;">This is an automated notification from LostLink.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: "Notification sent" });
  } catch (error) {
    console.error("Email Error:", error);
    res.status(500).json({ message: "Failed to send email" });
  }
};