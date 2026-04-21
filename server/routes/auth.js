require('dotenv').config();
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../config/cloudinary');

const sign = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// REGISTER
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role = 'student', phone, grade, province } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(400).json({ error: 'Email already registered' });

    // Tutors must wait for admin approval, everyone else is approved immediately
    const approved = role === 'tutor' ? false : true;

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role,
      phone: phone || '',
      grade: grade || '',
      province: province || '',
      approved,
      avatar: name[0].toUpperCase(),
      bio: '',
      avatarUrl: '',
    });

    const token = sign(user._id);
    console.log(`✅ New ${role} registered: ${name} (${email}) - Approved: ${approved}`);
    res.status(201).json({ token, user: user.toPublic() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(400).json({ error: 'Invalid email or password' });
    const ok = await user.comparePassword(password);
    if (!ok) return res.status(400).json({ error: 'Invalid email or password' });
    const token = sign(user._id);
    console.log(`✅ ${user.role} logged in: ${user.name} (${user.email})`);
    res.json({ token, user: user.toPublic() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET CURRENT USER
router.get('/me', auth, async (req, res) => {
  try {
    // Always get fresh data from DB
    const user = await User.findById(req.user._id).select('-password');
    res.json(user.toPublic ? user.toPublic() : user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// UPDATE PROFILE
router.put('/profile', auth, async (req, res) => {
  try {
    const { name, phone, grade, province, bio, avatar } = req.body;
    const updates = {};
    if (name && name.trim()) updates.name = name.trim();
    if (phone !== undefined) updates.phone = phone;
    if (grade !== undefined) updates.grade = grade;
    if (province !== undefined) updates.province = province;
    if (bio !== undefined) updates.bio = bio;
    if (avatar !== undefined) updates.avatar = avatar;
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');
    console.log(`✅ Profile updated: ${user.name}`);
    res.json(user.toPublic ? user.toPublic() : user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// UPLOAD AVATAR TO CLOUDINARY
router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const result = await uploadToCloudinary(req.file.buffer, 'peace-mindset/avatars', 'image');
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { avatarUrl: result.secure_url },
      { new: true }
    ).select('-password');
    console.log(`✅ Avatar uploaded to Cloudinary: ${result.secure_url}`);
    res.json({ url: result.secure_url, user: user.toPublic ? user.toPublic() : user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CHANGE PASSWORD
router.put('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both passwords required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const user = await User.findById(req.user._id);
    const ok = await user.comparePassword(currentPassword);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
    user.password = newPassword;
    await user.save();
    console.log(`✅ Password changed: ${user.name}`);
    res.json({ message: 'Password changed successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
