const express = require('express');
const router = express.Router();
const { Material } = require('../models');
const { auth, tutorOrAdmin } = require('../middleware/auth');
const { upload, uploadToCloudinary, getViewUrl, getDownloadUrl } = require('../config/cloudinary');

// Add view/download URLs to material object
const withUrls = (m) => {
  const obj = m.toObject ? m.toObject() : m;
  return {
    ...obj,
    view_url: getViewUrl(obj.file_url, obj.type),
    download_url: getDownloadUrl(obj.file_url, obj.title, obj.type),
  };
};

router.get('/', auth, async (req, res) => {
  try {
    const mats = await Material.find().sort('-createdAt');
    res.json(mats.map(withUrls));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, tutorOrAdmin, upload.single('file'), async (req, res) => {
  try {
    const { title, description, subject_id, type, premium } = req.body;
    let file_url = '', size = '';
    if (req.file) {
      // PDFs upload as 'image' type - Cloudinary serves these with correct
      // Content-Type headers so browsers render them inline natively.
      // Word/PowerPoint have no native browser viewer, so they stay 'raw' (download-only).
      const rType = ['video','audio'].includes(type) ? 'video'
        : ['pptx','word'].includes(type) ? 'raw'
        : 'image';
      const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/materials', rType);
      file_url = r.secure_url;
      size = req.file.size > 1024*1024
        ? Math.round(req.file.size/1024/1024)+'MB'
        : Math.round(req.file.size/1024)+'KB';
    }
    const m = await Material.create({
      title, description,
      subject_id: Number(subject_id),
      type,
      premium: premium !== 'false',
      file_url,
      size,
      tutor_id: req.user._id
    });
    res.status(201).json(withUrls(m));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Proxy VIEW - renders PDF inline in browser
router.get('/:id/view', auth, async (req, res) => {
  try {
    const m = await Material.findById(req.params.id);
    if (!m?.file_url) return res.status(404).send('File not found');
    const response = await fetch(m.file_url);
    if (!response.ok) return res.status(502).send('Could not fetch file');
    const ext = m.type === 'pdf' ? 'pdf' : m.type === 'word' ? 'docx' : m.type === 'pptx' ? 'pptx' : 'bin';
    const mime = m.type === 'pdf' ? 'application/pdf' : m.type === 'word' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/octet-stream';
    const filename = (m.title || 'file').replace(/[^a-z0-9]/gi, '_') + '.' + ext;
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', 'inline; filename="' + filename + '"');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { Readable } = require('stream');
    Readable.fromWeb(response.body).pipe(res);
  } catch(e) { res.status(500).send(e.message); }
});

// Proxy download - forces proper file download
router.get('/:id/download', auth, async (req, res) => {
  try {
    const m = await Material.findByIdAndUpdate(
      req.params.id,
      { $inc: { downloads: 1 } },
      { new: true }
    );
    if (!m?.file_url) return res.status(404).json({ error: 'File not found' });

    // Fetch file from Cloudinary and pipe it
    const response = await fetch(m.file_url);
    if (!response.ok) return res.status(502).json({ error: 'Could not fetch file' });

    const ext = m.type === 'pdf' ? 'pdf' : m.type === 'word' ? 'docx' : m.type === 'pptx' ? 'pptx' : m.type === 'image' ? 'jpg' : 'bin';
    const filename = (m.title || 'file').replace(/[^a-z0-9]/gi, '_') + '.' + ext;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');

    const { Readable } = require('stream');
    Readable.fromWeb(response.body).pipe(res);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Increment download count
router.post('/:id/download', auth, async (req, res) => {
  try {
    const m = await Material.findByIdAndUpdate(
      req.params.id,
      { $inc: { downloads: 1 } },
      { new: true }
    );
    res.json({ downloads: m.downloads });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, tutorOrAdmin, async (req, res) => {
  try {
    await Material.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
