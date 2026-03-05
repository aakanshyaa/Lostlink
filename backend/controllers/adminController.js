const db = require('../config/db');
const fs = require('fs');
const path = require('path');

// DASHBOARD STATS
exports.getStats = async (req, res) => {
  try {
    const [userCount] = await db.promise().query("SELECT COUNT(*) AS total FROM users");
    
    const [activeCount] = await db.promise().query(`
      SELECT (SELECT COUNT(*) FROM lost_items WHERE status='active') + 
             (SELECT COUNT(*) FROM found_items WHERE status='active') AS total`);

    const [resolvedCount] = await db.promise().query(`
      SELECT (SELECT COUNT(*) FROM lost_items WHERE status='resolved') + 
             (SELECT COUNT(*) FROM found_items WHERE status='resolved') AS total`);

    res.json({
      users: userCount[0].total,
      activeItems: activeCount[0].total,
      resolvedItems: resolvedCount[0].total
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch stats" });
  }
};

// USER MANAGEMENT
exports.getAllUsers = async (req, res) => {
  try {
    const [users] = await db.promise().query("SELECT user_id, full_name, email, role, is_blocked, created_at FROM users");
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Error fetching users" });
  }
};

exports.toggleBlockUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_blocked } = req.body; // Pass true or false from frontend
    await db.promise().query("UPDATE users SET is_blocked = ? WHERE user_id = ?", [is_blocked, id]);
    res.json({ message: `User ${is_blocked ? 'blocked' : 'unblocked'} successfully` });
  } catch (err) {
    res.status(500).json({ message: "Action failed" });
  }
};

// ITEM MODERATION

exports.deleteItem = async (req, res) => {
  try {
    const { type, id } = req.params;
    const table = type === 'lost' ? 'lost_items' : 'found_items';
    const idCol = type === 'lost' ? 'lost_id' : 'found_id';

    // 1. Get the image path from the database first
    const [rows] = await db.promise().query(
      `SELECT image FROM ${table} WHERE ${idCol} = ?`, 
      [id]
    );

    if (rows.length > 0 && rows[0].image) {
      // 2. Construct the absolute path to the file
      // Assuming your images are stored in a folder named 'uploads' at the root
      const imagePath = path.join(__dirname, '..', rows[0].image);

      // 3. Delete the file from the file system
      fs.unlink(imagePath, (err) => {
        if (err) {
          console.error("Failed to delete local file:", err.message);
          // We don't stop the process here; we still want to delete the DB record
        } else {
          console.log("File deleted successfully:", imagePath);
        }
      });
    }

    // 4. Delete the record from the database
    await db.promise().query(`DELETE FROM ${table} WHERE ${idCol} = ?`, [id]);

    res.json({ message: "Item and associated image deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Delete failed", error: err.message });
  }
};