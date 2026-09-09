const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { auth } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../config/cloudinary');

const mkToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET || 'peacemindset_secret', { expiresIn: '90d' });
const crypto = require('crypto');
const { Resend } = require('resend');
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ── POST /api/auth/forgot-password ──────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    // Always respond success even if user not found, to avoid leaking which emails are registered
    if (!user) return res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
    const token = crypto.randomBytes(32).toString('hex');
    user.resetToken = token;
    user.resetTokenExpiry = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    await user.save();
    const resetUrl = (process.env.FRONTEND_URL || 'https://peacemindsetgcezm.vercel.app') + '/?reset_token=' + token;
    if (!resend) {
      console.error('RESEND_API_KEY not configured - cannot send reset email');
      return res.status(500).json({ error: 'Email service is not configured yet. Please contact the school.' });
    }
    try {
      await resend.emails.send({
        from: 'Peace Mindset School <onboarding@resend.dev>',
        to: user.email,
        subject: 'Reset your Peace Mindset password',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:20px">
            <h2 style="color:#064d2c">Peace Mindset Private School</h2>
            <p>Hello ${user.name || 'there'},</p>
            <p>We received a request to reset your password. Click the button below to choose a new one. This link expires in 30 minutes.</p>
            <a href="${resetUrl}" style="display:inline-block;background:#064d2c;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">Reset Password</a>
            <p style="font-size:12px;color:#666">If you did not request this, you can safely ignore this email.</p>
            <p style="font-size:12px;color:#666">Or copy this link: ${resetUrl}</p>
          </div>
        `
      });
    } catch (emailErr) {
      console.error('Resend email error:', emailErr.message);
      return res.status(500).json({ error: 'Could not send reset email. Please try again shortly.' });
    }
    res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/auth/reset-password ───────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const user = await User.findOne({ resetToken: token, resetTokenExpiry: { $gt: new Date() } });
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
    user.password = await bcrypt.hash(password, 10);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();
    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, phone, grade, province } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(400).json({ error: 'Email already registered. Please login.' });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name: name.trim(), email: email.toLowerCase().trim(), password: hash, role: role || 'student', phone, grade, province, approved: role === 'admin' });
    res.status(201).json({ token: mkToken(user._id), user: { _id: user._id, name: user.name, email: user.email, role: user.role, approved: user.approved, phone: user.phone, grade: user.grade, province: user.province } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/login', async (req, res) => {
  try {
    const t0 = Date.now();
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    const t1 = Date.now();
    if (!user) return res.status(400).json({ error: 'No account found with this email. Please register first.' });
    const ok = await bcrypt.compare(password, user.password);
    const t2 = Date.now();
    console.log('LOGIN TIMING: query=' + (t1-t0) + 'ms bcrypt=' + (t2-t1) + 'ms total=' + (t2-t0) + 'ms');
    if (!ok) return res.status(400).json({ error: 'Wrong password. Please try again.' });
    res.json({ token: mkToken(user._id), user: { _id: user._id, name: user.name, email: user.email, role: user.role, approved: user.approved, phone: user.phone, grade: user.grade, province: user.province, avatar: user.avatar, avatarUrl: user.avatarUrl, bio: user.bio } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/me', auth, async (req, res) => {
  const u = req.user;
  res.json({ _id: u._id, name: u.name, email: u.email, role: u.role, approved: u.approved, phone: u.phone, grade: u.grade, province: u.province, avatar: u.avatar, avatarUrl: u.avatarUrl, bio: u.bio });
});

router.put('/profile', auth, async (req, res) => {
  try {
    const { name, phone, grade, province, bio, avatar } = req.body;
    const u = await User.findByIdAndUpdate(req.user._id, { name, phone, grade, province, bio, avatar }, { new: true });
    res.json({ _id: u._id, name: u.name, email: u.email, role: u.role, approved: u.approved, phone: u.phone, grade: u.grade, province: u.province, avatar: u.avatar, avatarUrl: u.avatarUrl, bio: u.bio });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const result = await uploadToCloudinary(req.file.buffer, 'peace-mindset/avatars', 'image');
    const u = await User.findByIdAndUpdate(req.user._id, { avatarUrl: result.secure_url }, { new: true });
    res.json({ user: { _id: u._id, name: u.name, email: u.email, role: u.role, approved: u.approved, avatarUrl: u.avatarUrl } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
