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
// Detect the real file type by sniffing actual bytes rather than trusting a stored label
async function proxyMaterial(fileUrl, title, declaredType, res, disposition) {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error('Could not fetch file');
  const buf = Buffer.from(await response.arrayBuffer());
  const isPdf = buf.slice(0, 5).toString('utf8') === '%PDF-';
  const isPng = buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
  const isJpg = buf.slice(0, 3).toString('hex') === 'ffd8ff';
  let mime, ext;
  if (isPdf) { mime = 'application/pdf'; ext = 'pdf'; }
  else if (isPng) { mime = 'image/png'; ext = 'png'; }
  else if (isJpg) { mime = 'image/jpeg'; ext = 'jpg'; }
  else if (declaredType === 'word') { mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; ext = 'docx'; }
  else if (declaredType === 'pptx') { mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'; ext = 'pptx'; }
  else { mime = response.headers.get('content-type') || 'application/octet-stream'; ext = 'bin'; }
  const filename = (title || 'file').replace(/[^a-z0-9]/gi, '_') + '.' + ext;
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', disposition + '; filename="' + filename + '"');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(buf);
}

// Proxy VIEW - renders PDF/image inline in browser
router.get('/:id/view', auth, async (req, res) => {
  try {
    const m = await Material.findById(req.params.id);
    if (!m?.file_url) return res.status(404).send('File not found');
    await proxyMaterial(m.file_url, m.title, m.type, res, 'inline');
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
    await proxyMaterial(m.file_url, m.title, m.type, res, 'attachment');
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
