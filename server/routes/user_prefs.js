const express = require('express');
const router = express.Router();
const { User, Message } = require('../models');
const { auth } = require('../middleware/auth');

// GET my preferences (notifications, blocked users)
router.get('/prefs', auth, async (req, res) => {
  try {
    const u = await User.findById(req.user._id).populate('blocked_users', 'name email avatar avatarUrl');
    res.json({
      notifications_enabled: u.notifications_enabled,
      blocked_users: u.blocked_users || [],
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT toggle notifications
router.put('/prefs/notifications', auth, async (req, res) => {
  try {
    const { enabled } = req.body;
    const u = await User.findByIdAndUpdate(
      req.user._id,
      { notifications_enabled: !!enabled },
      { new: true }
    );
    res.json({ notifications_enabled: u.notifications_enabled });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST block a user
router.post('/block/:userId', auth, async (req, res) => {
  try {
    const u = await User.findById(req.user._id);
    if (!u.blocked_users.some(b => b.toString() === req.params.userId)) {
      u.blocked_users.push(req.params.userId);
      await u.save();
    }
    const updated = await User.findById(req.user._id).populate('blocked_users', 'name email avatar avatarUrl');
    res.json({ blocked_users: updated.blocked_users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE unblock a user
router.delete('/block/:userId', auth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { blocked_users: req.params.userId } }
    );
    const updated = await User.findById(req.user._id).populate('blocked_users', 'name email avatar avatarUrl');
    res.json({ blocked_users: updated.blocked_users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE clear direct chat history between me and another user
router.delete('/clear-chat/:userId', auth, async (req, res) => {
  try {
    const result = await Message.deleteMany({
      type: 'direct',
      $or: [
        { sender_id: req.user._id, receiver_id: req.params.userId },
        { sender_id: req.params.userId, receiver_id: req.user._id },
      ],
    });
    res.json({ deleted: result.deletedCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE clear group chat history (admin of group only — done via groups route)
// But allow clearing subject-based group messages for the requester's view:
router.delete('/clear-group/:subjectId', auth, async (req, res) => {
  try {
    // Only admins/tutors can clear group history
    if (!['admin','tutor'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only tutors or admins can clear group chats' });
    }
    const result = await Message.deleteMany({
      type: 'group',
      subject_id: Number(req.params.subjectId),
    });
    res.json({ deleted: result.deletedCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
