const express = require("express");
const router = express.Router();
const itemController = require("../controllers/itemController");
const { protect } = require("../middleware/authMiddleware");
const upload = require("../middleware/multer");

// Public Feed & Search
router.get("/feed", itemController.getFeed);
router.get("/details/:type/:id", itemController.getItemDetails);

// Protected Actions
router.post("/post", protect, upload.single("image"), itemController.postItem);
router.post("/request", protect, itemController.createRequest);
router.post("/resolve", protect, itemController.resolveItem);
router.delete("/delete/:type/:id", protect, itemController.deleteItem);
router.get("/my-activity", protect, itemController.getMyActivity);

router.post("/notify-connection", protect, itemController.notifyConnection);

module.exports = router;