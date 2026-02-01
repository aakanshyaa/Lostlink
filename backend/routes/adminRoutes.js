const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const { protect, admin } = require("../middleware/authMiddleware");

// All routes here require Admin role
router.get("/stats", protect, admin, adminController.getStats);
router.get("/users", protect, admin, adminController.getAllUsers);
router.put("/users/block/:id", protect, admin, adminController.toggleBlockUser);
router.delete("/items/:type/:id", protect, admin, adminController.deleteItem);

module.exports = router;