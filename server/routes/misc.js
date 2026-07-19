const express = require('express');
const router = express.Router();
const { Message, LiveClass, Announcement } = require('../models');
const { auth, tutorOrAdmin, adminOnly } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../config/cloudinary');

// GET most recent direct message per conversation (seeds chat list previews)
router.get('/messages/recent', auth, async (req, res) => {
  try {
    const msgs = await Message.find({
      type: 'direct',
      $or: [{ sender_id: req.user._id }, { receiver_id: req.user._id }]
    }).sort('-createdAt').limit(500);
    const seen = new Set();
    const recent = [];
    for (const m of msgs) {
      const otherId = m.sender_id.toString() === req.user._id.toString() ? m.receiver_id.toString() : m.sender_id.toString();
      if (!seen.has(otherId)) { seen.add(otherId); recent.push(m); }
    }
    res.json(recent);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Messages
router.get('/messages/direct/:userId', auth, async (req, res) => {
  try {
    const msgs = await Message.find({ type: 'direct', $or: [{ sender_id: req.user._id, receiver_id: req.params.userId }, { sender_id: req.params.userId, receiver_id: req.user._id }] }).sort('createdAt');
    res.json(msgs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Mark direct messages as read
router.put('/messages/direct/:userId/read', auth, async (req, res) => {
  try {
    await Message.updateMany(
      { type: 'direct', sender_id: req.params.userId, receiver_id: req.user._id, is_read: false },
      { is_read: true, read_at: new Date() }
    );
    // Notify sender their messages were read
    req.app.get('io')?.to(`user_${req.params.userId}`).emit('messages_read', { by: req.user._id, from: req.params.userId });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/messages/direct', auth, upload.single('image'), async (req, res) => {
  try {
    const { receiver_id, content } = req.body;
    let image_url = '';
    if (req.file) { const rType = req.file.mimetype && (req.file.mimetype.startsWith('audio') || req.file.mimetype.startsWith('video')) ? 'video' : 'image'; const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/chat', rType); image_url = r.secure_url; }
    const m = await Message.create({ sender_id: req.user._id, receiver_id, content, image_url, type: 'direct' });
    // Emit via socket if available
    req.app.get('io')?.to(`user_${receiver_id}`).emit('new_direct_message', { ...m.toObject(), sender_id: req.user._id.toString() });
    res.status(201).json(m);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/messages/group/:subjectId', auth, async (req, res) => {
  try {
    const msgs = await Message.find({ type: 'group', subject_id: Number(req.params.subjectId) }).sort('createdAt').limit(100);
    res.json(msgs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/messages/group', auth, upload.single('image'), async (req, res) => {
  try {
    const { subject_id, content } = req.body;
    let image_url = '';
    if (req.file) { const rType = req.file.mimetype && (req.file.mimetype.startsWith('audio') || req.file.mimetype.startsWith('video')) ? 'video' : 'image'; const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/chat', rType); image_url = r.secure_url; }
    const m = await Message.create({ sender_id: req.user._id, subject_id: Number(subject_id), content, image_url, type: 'group' });
    req.app.get('io')?.to(`group_${subject_id}`).emit('new_group_message', { ...m.toObject(), sender_id: req.user._id.toString() });
    res.status(201).json(m);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete a message (sender only)
router.delete('/messages/:id', auth, async (req, res) => {
  try {
    const m = await Message.findById(req.params.id);
    if (!m) return res.status(404).json({ error: 'Message not found' });
    if (m.sender_id.toString() !== req.user._id.toString())
      return res.status(403).json({ error: 'You can only delete your own messages' });
    await Message.findByIdAndDelete(req.params.id);
    const io = req.app.get('io');
    if (io) {
      if (m.type === 'direct') {
        io.to('user_'+m.receiver_id).emit('message_deleted', { _id: req.params.id });
        io.to('user_'+m.sender_id).emit('message_deleted', { _id: req.params.id });
      } else if (m.type === 'group') {
        io.to('group_'+m.subject_id).emit('message_deleted', { _id: req.params.id });
      } else if (m.type === 'custom_group') {
        io.to('cg_'+m.group_id).emit('message_deleted', { _id: req.params.id });
      }
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/messages/custom-group/:id', auth, async (req, res) => {
  try {
    const m = await Message.findById(req.params.id);
    if (!m) return res.status(404).json({ error: 'Message not found' });
    if (m.sender_id.toString() !== req.user._id.toString())
      return res.status(403).json({ error: 'You can only delete your own messages' });
    await Message.findByIdAndDelete(req.params.id);
    const io = req.app.get('io');
    if (io) io.to('cg_'+m.group_id).emit('message_deleted', { _id: req.params.id });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Custom group messages (MongoDB _id based, not subject_id)
router.get('/messages/custom-group/:groupId', auth, async (req, res) => {
  try {
    const msgs = await Message.find({ type: 'custom_group', group_id: req.params.groupId }).sort('createdAt').limit(100);
    res.json(msgs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/messages/custom-group', auth, upload.single('image'), async (req, res) => {
  try {
    const { group_id, content } = req.body;
    let image_url = '';
    if (req.file) { const rType = req.file.mimetype && (req.file.mimetype.startsWith('audio') || req.file.mimetype.startsWith('video')) ? 'video' : 'image'; const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/chat', rType); image_url = r.secure_url; }
    const m = await Message.create({ sender_id: req.user._id, group_id, content, image_url, type: 'custom_group' });
    req.app.get('io')?.to('cg_'+group_id).emit('new_custom_group_message', { ...m.toObject(), sender_id: req.user._id.toString() });
    res.status(201).json(m);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Live Classes
router.get('/live-classes', auth, async (req, res) => {
  try { res.json(await LiveClass.find().sort('-createdAt')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/live-classes', auth, tutorOrAdmin, async (req, res) => {
  try {
    const cls = await LiveClass.create({ ...req.body, tutor_id: req.user._id });
    res.status(201).json(cls);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/live-classes/:id', auth, tutorOrAdmin, async (req, res) => {
  try {
    const updated = await LiveClass.findByIdAndUpdate(req.params.id, req.body, { new: true });
    const io = req.app.get('io');
    if (io && req.body.status === 'live') {
      io.emit('class_went_live', { _id: updated._id, title: updated.title, subject_id: updated.subject_id, tutor_id: updated.tutor_id });
    }
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/live-classes/:id', auth, tutorOrAdmin, async (req, res) => {
  try { await LiveClass.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/live-classes/:id/whiteboard', auth, async (req, res) => {
  try {
    const cls = await LiveClass.findById(req.params.id);
    res.json({
      strokes: cls?.whiteboard_data?.strokes || [],
      texts: cls?.whiteboard_data?.texts || [],
      images: cls?.whiteboard_data?.images || []
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/live-classes/:id/whiteboard-upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const isPdf = req.file.mimetype === 'application/pdf';

    if (isPdf) {
      // Upload as raw but force .pdf extension so it opens/renders correctly
      const cloudinary = require('../config/cloudinary').cloudinary;
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'peace-mindset/whiteboard', resource_type: 'raw', format: 'pdf', public_id: 'pdf_' + Date.now() },
          (err, res2) => err ? reject(err) : resolve(res2)
        );
        stream.end(req.file.buffer);
      });
      // Cloudinary can render page 1 of a PDF as a JPG thumbnail via image/upload with .jpg on the same public_id
      const thumbUrl = result.secure_url
        .replace('/raw/upload/', '/image/upload/pg_1,w_600,q_auto,f_jpg/')
        .replace(/\.pdf$/, '.jpg');
      return res.json({ url: result.secure_url, thumbUrl, type: 'pdf' });
    }

    const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/whiteboard', 'image');
    res.json({ url: r.secure_url, type: 'image' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/live-classes/:id/whiteboard', auth, async (req, res) => {
  try {
    await LiveClass.findByIdAndUpdate(req.params.id, { whiteboard_data: req.body });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Announcements
router.get('/announcements', auth, async (req, res) => {
  try { res.json(await Announcement.find().sort('-createdAt').limit(20)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/announcements', auth, adminOnly, async (req, res) => {
  try { res.status(201).json(await Announcement.create({ ...req.body, author_id: req.user._id })); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/announcements/:id', auth, adminOnly, async (req, res) => {
  try { await Announcement.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/view-file — proxy PDF/doc with correct headers ──
router.get('/view-file', auth, async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || !url.startsWith('https://')) return res.status(400).send('Invalid URL');
    const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
    const r = await fetch(url);
    const ct = r.headers.get('content-type') || 'application/pdf';
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Access-Control-Allow-Origin', '*');
    r.body.pipe(res);
  } catch(e) {
    res.status(500).send('Could not load file');
  }
});

module.exports = router;
