const express = require('express');
const router = express.Router();
const { LiveClass } = require('../models');
const { auth, tutorOrAdmin } = require('../middleware/auth');
const { requireTutorFee } = require('../middleware/tutorFee');
const { studentHasAccess, activeTutorIds, tutorFeeExpiry } = require('../services/access');
const { upload, uploadToCloudinary } = require('../config/cloudinary');
const mongoose = require('mongoose');

const SENSITIVE = ['meet_link', 'recording_url', 'whiteboard_data', 'lesson_script'];
const lockView = (c) => { const o = c.toObject ? c.toObject() : { ...c }; SENSITIVE.forEach(k => delete o[k]); o.locked = true; return o; };
const isOwner = (u, c) => String(c.tutor_id) === String(u._id);

// Single server-side rule used everywhere
async function canView(user, cls) {
  if (user.role === 'admin') return true;
  if (user.role === 'tutor') return isOwner(user, cls);
  return !!cls.tutor_id && (await studentHasAccess(user._id, cls.tutor_id));
}

router.get('/live-classes', auth, async (req, res) => {
  try {
    const list = await LiveClass.find().sort('-createdAt');
    if (req.user.role === 'admin') return res.json(list);
    if (req.user.role === 'tutor') return res.json(list.map(c => isOwner(req.user, c) ? c : lockView(c)));
    const ok = new Set(await activeTutorIds(req.user._id));
    res.json(list.map(c => (c.tutor_id && ok.has(String(c.tutor_id))) ? { ...c.toObject(), locked: false } : lockView(c)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Scheduling needs a paid K20 fee
router.post('/live-classes', auth, tutorOrAdmin, requireTutorFee, async (req, res) => {
  try {
    const body = { ...req.body }; delete body._id;
    res.status(201).json(await LiveClass.create({ ...body, tutor_id: req.user._id }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/live-classes/:id', auth, tutorOrAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid class' });
    const cls = await LiveClass.findById(req.params.id);
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    if (req.user.role === 'tutor') {
      if (!isOwner(req.user, cls)) return res.status(403).json({ error: 'Not your class' });
      if (req.body.status === 'live' && !(await tutorFeeExpiry(req.user._id)))
        return res.status(402).json({ error: 'K20 monthly fee unpaid. Pay it to start classes.', code: 'TUTOR_FEE_REQUIRED' });
    }
    const body = { ...req.body }; delete body.tutor_id; delete body._id;
    const updated = await LiveClass.findByIdAndUpdate(req.params.id, body, { new: true });
    const io = req.app.get('io');
    if (io && body.status === 'live')
      io.emit('class_went_live', { _id: updated._id, title: updated.title, subject_id: updated.subject_id, tutor_id: updated.tutor_id });
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/live-classes/:id', auth, tutorOrAdmin, async (req, res) => {
  try {
    const filter = { _id: req.params.id };
    if (req.user.role === 'tutor') filter.tutor_id = req.user._id;
    const r = await LiveClass.deleteOne(filter);
    if (!r.deletedCount) return res.status(404).json({ error: 'Not found or not yours' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/live-classes/:id/whiteboard', auth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid class' });
    const cls = await LiveClass.findById(req.params.id);
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    if (!(await canView(req.user, cls))) return res.status(403).json({ error: 'Locked. Subscribe to this tutor to join.', code: 'LOCKED' });
    res.json({
      strokes: cls.whiteboard_data?.strokes || [], texts: cls.whiteboard_data?.texts || [],
      images: cls.whiteboard_data?.images || [], boardH: cls.whiteboard_data?.boardH || 1400
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/live-classes/:id/whiteboard-upload', auth, tutorOrAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/whiteboard', 'image');
    res.json({ url: r.secure_url, type: 'image' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Only the class owner (or admin) may write the board
router.post('/live-classes/:id/whiteboard', auth, tutorOrAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid class' });
    const cls = await LiveClass.findById(req.params.id);
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    if (req.user.role === 'tutor' && !isOwner(req.user, cls)) return res.status(403).json({ error: 'Not your class' });
    await LiveClass.updateOne({ _id: cls._id }, { whiteboard_data: req.body });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
