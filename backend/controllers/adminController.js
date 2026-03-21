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


exports.deleteUser = async (req, res) => {
  const connection = await db.promise().getConnection();
  try {
    const { id } = req.params;

    // Start a transaction so if one part fails, everything rolls back
    await connection.beginTransaction();

    // 1. Get all image paths for this user's items before deleting them
    const [lostItems] = await connection.query("SELECT image FROM lost_items WHERE user_id = ?", [id]);
    const [foundItems] = await connection.query("SELECT image FROM found_items WHERE user_id = ?", [id]);
    
    const allImages = [...lostItems, ...foundItems].map(item => item.image).filter(Boolean);

    // 2. Delete the user (If your DB has ON DELETE CASCADE, items will vanish automatically)
    // If not, we manually delete them:
    await connection.query("DELETE FROM lost_items WHERE user_id = ?", [id]);
    await connection.query("DELETE FROM found_items WHERE user_id = ?", [id]);
    await connection.query("DELETE FROM users WHERE user_id = ?", [id]);

    // 3. Commit the Database changes
    await connection.commit();

    // 4. Cleanup the File System (Images)
    allImages.forEach(imagePath => {
      const fullPath = path.join(__dirname, '..', imagePath);
      if (fs.existsSync(fullPath)) {
        fs.unlink(fullPath, (err) => {
          if (err) console.error("File deletion failed:", err);
        });
      }
    });

    res.json({ message: "User and all associated data purged successfully." });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ message: "Failed to delete user", error: err.message });
  } finally {
    connection.release();
  }
};


// ADMIN RESOLVE FEATURE
exports.resolveItem = async (req, res) => {
  try {
    const { type, id } = req.body; // type and id sent from AdminDashboard
    const table = type === 'lost' ? 'lost_items' : 'found_items';
    const idCol = type === 'lost' ? 'lost_id' : 'found_id';

    // In the Admin controller, we DON'T check for user_id 
    // because the Admin has the authority to resolve any post.
    const [result] = await db.promise().query(
      `UPDATE ${table} SET status = 'resolved' WHERE ${idCol} = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Item not found" });
    }

    res.json({ message: "Item marked as resolved by Admin" });
  } catch (err) {
    console.error("Admin Resolve Error:", err);
    res.status(500).json({ message: "Failed to resolve item", error: err.message });
  }
};



exports.getResolvedReports = async (req, res) => {
  try {
    // Specifically querying for the 'resolved' status
    const [rows] = await db.execute(
      `SELECT * FROM lost_items WHERE status = 'resolved' 
       UNION ALL 
       SELECT * FROM found_items WHERE status = 'resolved' 
       ORDER BY updated_at DESC`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Error fetching archive" });
  }
};