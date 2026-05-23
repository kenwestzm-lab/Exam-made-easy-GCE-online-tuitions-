const express = require('express');
const router = express.Router();
const { User } = require('../models');
const { auth, adminOnly } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const users = await User.find({ role: { $ne: 'admin' } }).select('-password').sort('-createdAt');
    res.json(users);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    const u = await User.findByIdAndUpdate(req.params.id, { approved: true }, { new: true }).select('-password');
    res.json(u);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
