const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { auth } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../config/cloudinary');

const mkToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET || 'peacemindset_secret', { expiresIn: '90d' });

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, phone, grade, province } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(400).json({ error: 'Email already registered. Please login.' });
    const hash = await bcrypt.hash(password, 12);
    const user = await User.create({ name: name.trim(), email: email.toLowerCase().trim(), password: hash, role: role || 'student', phone, grade, province, approved: role === 'admin' });
    res.status(201).json({ token: mkToken(user._id), user: { _id: user._id, name: user.name, email: user.email, role: user.role, approved: user.approved, phone: user.phone, grade: user.grade, province: user.province } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(400).json({ error: 'No account found with this email. Please register first.' });
    const ok = await bcrypt.compare(password, user.password);
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
