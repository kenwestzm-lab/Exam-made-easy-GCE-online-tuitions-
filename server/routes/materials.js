const express = require('express');
const router = express.Router();
const { Material } = require('../models');
const { auth, tutorOrAdmin } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../config/cloudinary');

router.get('/', auth, async (req, res) => {
  try { res.json(await Material.find().sort('-createdAt')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, tutorOrAdmin, upload.single('file'), async (req, res) => {
  try {
    const { title, description, subject_id, type, premium } = req.body;
    let file_url = '', size = '';
    if (req.file) {
      const rType = ['video','audio'].includes(type) ? 'video' : ['pdf','pptx','word'].includes(type) ? 'raw' : 'image';
      const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/materials', rType);
      file_url = r.secure_url;
      size = req.file.size > 1024*1024 ? Math.round(req.file.size/1024/1024)+'MB' : Math.round(req.file.size/1024)+'KB';
    }
    const m = await Material.create({ title, description, subject_id: Number(subject_id), type, premium: premium !== 'false', file_url, size, tutor_id: req.user._id });
    res.status(201).json(m);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, tutorOrAdmin, async (req, res) => {
  try { await Material.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
