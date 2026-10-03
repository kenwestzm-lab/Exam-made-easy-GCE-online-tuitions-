const express = require('express');
const router = express.Router();
const { Material } = require('../models');
const { auth, tutorOrAdmin } = require('../middleware/auth');
const { requireTutorFee } = require('../middleware/tutorFee');
const { activeTutorIds, studentHasAccess, tutorFeeExpiry } = require('../services/access');
const { upload, uploadToCloudinary, getViewUrl, getDownloadUrl } = require('../config/cloudinary');

const withUrls = (m) => {
  const obj = m.toObject ? m.toObject() : m;
  return { ...obj, view_url: getViewUrl(obj.file_url, obj.type), download_url: getDownloadUrl(obj.file_url, obj.title, obj.type) };
};

// Server-side gate used by list, view and download
async function canAccess(user, m) {
  if (user.role === 'admin') return true;
  if (user.role === 'tutor') return !!(await tutorFeeExpiry(user._id));
  return !m.tutor_id || (await studentHasAccess(user._id, m.tutor_id));
}

router.get('/', auth, async (req, res) => {
  try {
    const mats = await Material.find().sort('-createdAt');
    if (req.user.role === 'admin') return res.json(mats.map(withUrls));
    if (req.user.role === 'tutor') {
      if (!(await tutorFeeExpiry(req.user._id)))
        return res.status(402).json({ error: 'Your K20 monthly fee is unpaid. Pay it to access materials.', code: 'TUTOR_FEE_REQUIRED' });
      return res.json(mats.map(withUrls));
    }
    const ok = new Set(await activeTutorIds(req.user._id));
    res.json(mats.map(m => {
      if (!m.tutor_id || ok.has(String(m.tutor_id))) return { ...withUrls(m), locked: false };
      const o = m.toObject(); delete o.file_url;
      return { ...o, locked: true };
    }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, tutorOrAdmin, requireTutorFee, upload.single('file'), async (req, res) => {
  try {
    const { title, description, subject_id, type, premium } = req.body;
    let file_url = '', size = '';
    if (req.file) {
      const rType = ['video','audio'].includes(type) ? 'video'
        : ['pptx','word'].includes(type) ? 'raw'
        : 'image';
      const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/materials', rType);
      file_url = r.secure_url;
      size = req.file.size > 1024*1024 ? Math.round(req.file.size/1024/1024)+'MB' : Math.round(req.file.size/1024)+'KB';
    }
    const m = await Material.create({ title, description, subject_id: Number(subject_id), type, premium: premium !== 'false', file_url, size, tutor_id: req.user._id });
    res.status(201).json(withUrls(m));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

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

const denied = (res, user) => res.status(user.role === 'tutor' ? 402 : 403)
  .json({ error: user.role === 'tutor' ? 'K20 monthly fee unpaid' : 'Locked. Subscribe to this tutor to unlock.', code: 'LOCKED' });

router.get('/:id/view', auth, async (req, res) => {
  try {
    const m = await Material.findById(req.params.id);
    if (!m?.file_url) return res.status(404).send('File not found');
    if (!(await canAccess(req.user, m))) return denied(res, req.user);
    await proxyMaterial(m.file_url, m.title, m.type, res, 'inline');
  } catch(e) { res.status(500).send(e.message); }
});

router.get('/:id/download', auth, async (req, res) => {
  try {
    const m = await Material.findById(req.params.id);
    if (!m?.file_url) return res.status(404).json({ error: 'File not found' });
    if (!(await canAccess(req.user, m))) return denied(res, req.user);
    await Material.updateOne({ _id: m._id }, { $inc: { downloads: 1 } });
    await proxyMaterial(m.file_url, m.title, m.type, res, 'attachment');
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/download', auth, async (req, res) => {
  try {
    const m0 = await Material.findById(req.params.id);
    if (!m0) return res.status(404).json({ error: 'Not found' });
    if (!(await canAccess(req.user, m0))) return denied(res, req.user);
    const m = await Material.findByIdAndUpdate(req.params.id, { $inc: { downloads: 1 } }, { new: true });
    res.json({ downloads: m.downloads });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// A tutor can delete only their own material; admin can delete any
router.delete('/:id', auth, tutorOrAdmin, requireTutorFee, async (req, res) => {
  try {
    const filter = { _id: req.params.id };
    if (req.user.role === 'tutor') filter.tutor_id = req.user._id;
    const r = await Material.deleteOne(filter);
    if (!r.deletedCount) return res.status(404).json({ error: 'Not found or not yours' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
