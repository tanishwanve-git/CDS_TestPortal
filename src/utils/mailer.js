const nodemailer = require('nodemailer');
require('dotenv').config();

// Works for both @gmail.com AND Google Workspace accounts (@iitgn.ac.in etc.)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,           // true for port 465 (SSL)
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS  // Gmail App Password (16-char, spaces are okay)
    }
});

/**
 * Send a 6-digit OTP to the given email.
 * @param {string} to  - recipient email
 * @param {string} otp - 6-digit code
 */
async function sendOTPEmail(to, otp) {
    const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to,
        subject: 'CDS Portal — Password Reset OTP',
        html: `
            <div style="font-family: 'Inter', Arial, sans-serif; max-width: 480px; margin: 0 auto;
                        border: 1px solid #dadce0; border-radius: 12px; overflow: hidden;">
                <div style="background: #1a73e8; padding: 24px; text-align: center;">
                    <h2 style="color: white; margin: 0; font-size: 20px;">CDS Test Portal</h2>
                    <p  style="color: rgba(255,255,255,0.85); margin: 4px 0 0; font-size: 13px;">Career Development Services</p>
                </div>
                <div style="padding: 32px 28px;">
                    <h3 style="color: #202124; margin: 0 0 8px;">Password Reset Request</h3>
                    <p style="color: #5f6368; font-size: 14px; margin: 0 0 24px;">
                        Use the one-time password (OTP) below to reset your CDS Portal password.
                        This code is valid for <strong>10 minutes</strong> and can only be used once.
                    </p>

                    <div style="background: #f8f9fa; border: 2px dashed #dadce0; border-radius: 10px;
                                text-align: center; padding: 20px 0; margin-bottom: 24px;">
                        <span style="font-size: 38px; font-weight: 700; letter-spacing: 10px;
                                     color: #1a73e8; font-family: monospace;">${otp}</span>
                    </div>

                    <p style="color: #5f6368; font-size: 13px; margin: 0;">
                        If you did not request a password reset, please ignore this email.
                        Your account remains secure.
                    </p>
                </div>
                <div style="background: #f8f9fa; padding: 16px 28px; text-align: center;
                            font-size: 12px; color: #9aa0a6; border-top: 1px solid #dadce0;">
                    &copy; ${new Date().getFullYear()} Career Development Services &mdash; All rights reserved
                </div>
            </div>
        `
    };

    await transporter.sendMail(mailOptions);
}

module.exports = { sendOTPEmail };
