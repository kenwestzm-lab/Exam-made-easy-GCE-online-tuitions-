const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { auth } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../config/cloudinary');

const sign = id => jwt.sign({ id }, process.env.JWT_SECRET || 'peacemindset_secret', { expiresIn: '90d' });

const clean = u => {
  const o = u.toObject ? u.toObject() : { ...u };
  delete o.password; return o;
};

// REGISTER
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, phone, grade, province } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const exists = await User.findOne({ email: email.toLowerCase().trim() });
    if (exists) return res.status(400).json({ error: 'An account with this email already exists. Please sign in.' });
    const hash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hash,
      role: role || 'student',
      phone: phone || '',
      grade: grade || '',
      province: province || 'Lusaka',
      avatar: name.trim()[0].toUpperCase(),
      approved: role === 'tutor' ? false : true
    });
    res.status(201).json({ token: sign(user._id), user: clean(user) });
  } catch(e) {
    console.error('Register error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Please enter your email and password' });
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user) return res.status(401).json({ error: 'No account found with this email. Please register first.' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    res.json({ token: sign(user._id), user: clean(user) });
  } catch(e) {
    console.error('Login error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET ME
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(clean(user));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// UPDATE PROFILE
router.put('/profile', auth, async (req, res) => {
  try {
    const { name, phone, grade, province, bio, avatar } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { name, phone, grade, province, bio, avatar } },
      { new: true, runValidators: false }
    );
    res.json(clean(user));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// UPLOAD AVATAR
router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/avatars', 'image');
    const user = await User.findByIdAndUpdate(req.user._id, { avatarUrl: r.secure_url }, { new: true });
    res.json({ url: r.secure_url, user: clean(user) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// CHANGE PASSWORD
router.put('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(401).json({ error: 'Current password is wrong' });
    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    res.json({ message: 'Password changed successfully' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
