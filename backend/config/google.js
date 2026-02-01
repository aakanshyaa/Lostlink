
const { OAuth2Client } = require("google-auth-library");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID; // <-- must match frontend
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

module.exports = { googleClient, GOOGLE_CLIENT_ID };
