const express = require('express');
const router = express.Router();
const { Group, Message } = require('../models');
const { auth } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../config/cloudinary');

const populateGroup = (q) => q.populate('members', 'name email avatar avatarUrl role')
  .populate('admins', 'name email avatar avatarUrl role')
  .populate('pending_requests', 'name email avatar avatarUrl role')
  .populate('created_by', 'name email');

router.get('/', auth, async (req, res) => {
  try {
    const groups = await populateGroup(Group.find({
      $or: [{ members: req.user._id }, { admins: req.user._id }]
    })).sort('-createdAt');
    res.json(groups);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/all', auth, async (req, res) => {
  try {
    const groups = await populateGroup(Group.find()).sort('-createdAt');
    res.json(groups);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, upload.single('photo'), async (req, res) => {
  try {
    const { name, bio, member_ids } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Group name is required' });
    let photo = '';
    if (req.file) {
      const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/groups', 'image');
      photo = r.secure_url;
    }
    let members = [req.user._id];
    if (member_ids) {
      const ids = Array.isArray(member_ids) ? member_ids : JSON.parse(member_ids);
      members = [...new Set([...members, ...ids])];
    }
    const g = await Group.create({
      name: name.trim(), bio: bio || '', photo, members,
      admins: [req.user._id], created_by: req.user._id,
    });
    const populated = await populateGroup(Group.findById(g._id));
    const io = req.app.get('io');
    if (io) members.forEach(m => io.to(`user_${m}`).emit('group_created', populated));
    res.status(201).json(populated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', auth, upload.single('photo'), async (req, res) => {
  try {
    const g = await Group.findById(req.params.id);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    if (!g.admins.some(a => a.toString() === req.user._id.toString())) {
      return res.status(403).json({ error: 'Only group admins can edit this group' });
    }
    const { name, bio } = req.body;
    if (name && name.trim()) g.name = name.trim();
    if (bio !== undefined) g.bio = bio;
    if (req.file) {
      const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/groups', 'image');
      g.photo = r.secure_url;
    }
    await g.save();
    const populated = await populateGroup(Group.findById(g._id));
    const io = req.app.get('io');
    if (io) g.members.forEach(m => io.to(`user_${m}`).emit('group_updated', populated));
    res.json(populated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/members', auth, async (req, res) => {
  try {
    const g = await Group.findById(req.params.id);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    if (!g.admins.some(a => a.toString() === req.user._id.toString())) {
      return res.status(403).json({ error: 'Only group admins can add members' });
    }
    const { member_ids } = req.body;
    const ids = Array.isArray(member_ids) ? member_ids : [member_ids];
    g.members = [...new Set([...g.members.map(String), ...ids])];
    g.pending_requests = g.pending_requests.filter(p => !ids.includes(p.toString()));
    await g.save();
    const populated = await populateGroup(Group.findById(g._id));
    const io = req.app.get('io');
    if (io) ids.forEach(uid => io.to(`user_${uid}`).emit('group_added', populated));
    res.json(populated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/members/:userId', auth, async (req, res) => {
  try {
    const g = await Group.findById(req.params.id);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    const isAdmin = g.admins.some(a => a.toString() === req.user._id.toString());
    const isSelf = req.params.userId === req.user._id.toString();
    if (!isAdmin && !isSelf) return res.status(403).json({ error: 'Not allowed' });
    g.members = g.members.filter(m => m.toString() !== req.params.userId);
    g.admins = g.admins.filter(a => a.toString() !== req.params.userId);
    await g.save();
    const populated = await populateGroup(Group.findById(g._id));
    const io = req.app.get('io');
    if (io) io.to(`user_${req.params.userId}`).emit('group_removed', { groupId: g._id });
    res.json(populated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/request', auth, async (req, res) => {
  try {
    const g = await Group.findById(req.params.id);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    if (g.members.some(m => m.toString() === req.user._id.toString())) {
      return res.status(400).json({ error: 'Already a member' });
    }
    if (!g.pending_requests.some(p => p.toString() === req.user._id.toString())) {
      g.pending_requests.push(req.user._id);
      await g.save();
    }
    const populated = await populateGroup(Group.findById(g._id));
    const io = req.app.get('io');
    if (io) g.admins.forEach(a => io.to(`user_${a}`).emit('group_join_request', { group: populated, requester: req.user.name }));
    res.json(populated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/requests/:userId/approve', auth, async (req, res) => {
  try {
    const g = await Group.findById(req.params.id);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    if (!g.admins.some(a => a.toString() === req.user._id.toString())) {
      return res.status(403).json({ error: 'Only group admins can approve requests' });
    }
    g.pending_requests = g.pending_requests.filter(p => p.toString() !== req.params.userId);
    if (!g.members.some(m => m.toString() === req.params.userId)) g.members.push(req.params.userId);
    await g.save();
    const populated = await populateGroup(Group.findById(g._id));
    const io = req.app.get('io');
    if (io) io.to(`user_${req.params.userId}`).emit('group_request_approved', populated);
    res.json(populated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/requests/:userId/reject', auth, async (req, res) => {
  try {
    const g = await Group.findById(req.params.id);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    if (!g.admins.some(a => a.toString() === req.user._id.toString())) {
      return res.status(403).json({ error: 'Only group admins can reject requests' });
    }
    g.pending_requests = g.pending_requests.filter(p => p.toString() !== req.params.userId);
    await g.save();
    const populated = await populateGroup(Group.findById(g._id));
    res.json(populated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const g = await Group.findById(req.params.id);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    if (!g.admins.some(a => a.toString() === req.user._id.toString())) {
      return res.status(403).json({ error: 'Only group admins can delete this group' });
    }
    const memberIds = g.members.map(String);
    await Group.findByIdAndDelete(req.params.id);
    const io = req.app.get('io');
    if (io) memberIds.forEach(m => io.to(`user_${m}`).emit('group_deleted', { groupId: req.params.id }));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
