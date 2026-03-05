const db = require('../config/db');

// POST A NEW ITEM (Lost or Found)
exports.postItem = async (req, res) => {
  try {
    const { type, item_name, category, description, location, latitude, longitude, date } = req.body;
    const user_id = req.user.user_id;
    const image = req.file ? `/uploads/${req.file.filename}` : null;

    const table = type === 'lost' ? 'lost_items' : 'found_items';
    const dateCol = type === 'lost' ? 'lost_date' : 'found_date';

    const sql = `INSERT INTO ${table} (user_id, item_name, category, description, location, latitude, longitude, ${dateCol}, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    await db.promise().query(sql, [user_id, item_name, category, description, location, latitude, longitude, date, image]);
    res.status(201).json({ message: "Item posted successfully" });
  } catch (err) {
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

    // Category filter (buttons)
    if (category && category !== "All") {
      whereClauses.push("category = ?");
      whereParams.push(category);
    }

    // Search (item, location, category)
    if (search) {
      whereClauses.push(
        "(item_name LIKE ? OR location LIKE ? OR category LIKE ?)"
      );
      whereParams.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`
      );
    }

    const whereSql = whereClauses.join(" AND ");

    const lostSql = `
      SELECT 
        lost_id AS id,
        item_name,
        category,
        location,
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
        image,
        created_at,
        'found' AS type
      FROM found_items
      WHERE ${whereSql}
    `;

    let finalSql = "";
    let finalParams = [];

    if (type === "lost") {
      finalSql = `
        ${lostSql}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `;
      finalParams = [...whereParams, limitNum, offset];
    } else if (type === "found") {
      finalSql = `
        ${foundSql}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `;
      finalParams = [...whereParams, limitNum, offset];
    } else {
      finalSql = `
        (${lostSql})
        UNION ALL
        (${foundSql})
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `;
      finalParams = [
        ...whereParams,
        ...whereParams,
        limitNum,
        offset,
      ];
    }

    const [items] = await db.promise().query(finalSql, finalParams);
    res.json(items);
  } catch (err) {
    console.error("Feed error:", err);
    res.status(500).json({
      message: "Feed error",
      error: err.message,
    });
  }
};


// GET ITEM DETAILS + OWNER INFO (For WhatsApp)
exports.getItemDetails = async (req, res) => {
  try {
    const { type, id } = req.params;
    const table = type === 'lost' ? 'lost_items' : 'found_items';
    const idCol = type === 'lost' ? 'lost_id' : 'found_id';

    const sql = `
      SELECT t.*, u.full_name, u.phone, u.email 
      FROM ${table} t 
      JOIN users u ON t.user_id = u.user_id 
      WHERE t.${idCol} = ?`;

    const [rows] = await db.promise().query(sql, [id]);
    if (rows.length === 0) return res.status(404).json({ message: "Item not found" });
    res.json(rows[0]);
  } catch (err) {
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