const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "np03cs4s240093@heraldcollege.edu.np",
    pass: "Herald@12345", // app password
  },
});

module.exports = transporter;