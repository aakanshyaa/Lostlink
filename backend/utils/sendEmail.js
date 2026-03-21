const nodemailer = require("nodemailer");

const sendWelcomeEmail = async (userEmail, userName) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER_FOR_MAIL,
        pass: process.env.EMAIL_PASS_FOR_MAIL,
      },
    });

    const mailOptions = {
      from: `"LostLink Support" <${process.env.EMAIL_USER_FOR_MAIL}>`,
      to: userEmail,
      subject: "Welcome to LostLink!",
      html: `
        <div style="font-family: sans-serif; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; max-width: 600px;">
          <h2 style="color: #10b981;">Hi ${userName}, welcome aboard!</h2>
          <p>Thank you for joining LostLink. Your account has been successfully created.</p>
          <p>You can now start reporting lost items or helping your community.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #94a3b8;">If you did not sign up for this account, please ignore this email.</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent: " + info.response);
    return info;
  } catch (error) {
    console.error("Nodemailer Error:", error);
    throw error;
  }
};

// CommonJS export
module.exports = sendWelcomeEmail;