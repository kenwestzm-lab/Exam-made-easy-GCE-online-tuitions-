const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { Assignment, Submission } = require('../models');
const { auth, tutorOrAdmin } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../config/cloudinary');
const { studentHasAccess, activeKeys, accessKey } = require('../services/access');

const isId = id => mongoose.isValidObjectId(id);
const plain = a => (a && a.toObject ? a.toObject() : { ...a });
const hideFile = a => { const o = plain(a); o.file_url = o.file_url ? 'protected' : ''; return o; };
const owns = (u, a) => u.role === 'admin' || String(a.tutor_id) === String(u._id);

async function canSee(u, a) {
  if (!a) return false;
  if (u.role === 'admin') return true;
  if (u.role === 'tutor') return String(a.tutor_id) === String(u._id);
  return !!a.tutor_id && await studentHasAccess(u._id, a.tutor_id, a.subject_id);
}
async function canSeeSub(u, s) {
  if (!s) return false;
  if (u.role === 'admin' || String(s.student_id) === String(u._id)) return true;
  if (u.role === 'tutor') { const a = await Assignment.findById(s.assignment_id).select('tutor_id'); return !!a && String(a.tutor_id) === String(u._id); }
  return false;
}

// Push a new assignment live, only to online students who have paid this tutor
async function pushToPaid(io, a) {
  if (!io) return;
  io.to('user_' + a.tutor_id).emit('new_assignment', plain(a));
  io.to('admins').emit('new_assignment', plain(a));
  if (!a.tutor_id) return;
  const ids = new Set();
  for (const s of io.sockets.sockets.values()) { const u = s.data && s.data.user; if (u && u.role === 'student') ids.add(String(u._id)); }
  const payload = hideFile(a);
  await Promise.all([...ids].map(async id => { try { if (await studentHasAccess(id, a.tutor_id, a.subject_id)) io.to('user_' + id).emit('new_assignment', payload); } catch (e) {} }));
}

router.get('/', auth, async (req, res) => {
  try {
    const u = req.user;
    if (u.role === 'admin') return res.json(await Assignment.find().sort('-createdAt'));
    if (u.role === 'tutor') return res.json(await Assignment.find({ tutor_id: u._id }).sort('-createdAt'));
    const ok = new Set(await activeKeys(u._id));
    const list = await Assignment.find().sort('-createdAt');
    res.json(list.filter(a => a.tutor_id && ok.has(accessKey(a.tutor_id, a.subject_id))).map(hideFile));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, tutorOrAdmin, upload.single('file'), async (req, res) => {
  try {
    const { title, description, subject_id, due_date, max_marks } = req.body;
    let file_url = '';
    if (req.file) {
      const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/assignments', 'raw');
      file_url = r.secure_url;
    }
    const a = await Assignment.create({ title, description, subject_id: Number(subject_id), due_date, max_marks: Number(max_marks) || 20, file_url, tutor_id: req.user._id });
    pushToPaid(req.app.get('io'), a).catch(e => console.error('assignment push:', e.message));
    res.status(201).json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Work out the real file type from the file's own first bytes (Cloudinary raw uploads carry no type)
const OFFICE = { docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'word/'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xl/'], pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'ppt/'] };
function sniff(b) {
  const s = (a, z) => b.slice(a, z).toString('latin1');
  if (s(0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf', inline: true };
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg', inline: true };
  if (b[0] === 0x89 && s(1, 4) === 'PNG') return { mime: 'image/png', ext: 'png', inline: true };
  if (s(0, 3) === 'GIF') return { mime: 'image/gif', ext: 'gif', inline: true };
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp', inline: true };
  if (b[0] === 0x50 && b[1] === 0x4B) {
    const names = s(0, 65536) + s(Math.max(0, b.length - 65536), b.length);
    for (const [ext, [mime, key]] of Object.entries(OFFICE)) if (names.includes(key)) return { mime, ext, inline: false };
    return { mime: 'application/zip', ext: 'zip', inline: false };
  }
  if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return { mime: 'application/msword', ext: 'doc', inline: false };
  const sample = b.slice(0, 2000); let bad = 0; for (const c of sample) if (c < 9 || (c > 13 && c < 32)) bad++;
  if (sample.length && bad === 0) return { mime: 'text/plain; charset=utf-8', ext: 'txt', inline: true };
  return { mime: 'application/octet-stream', ext: 'bin', inline: false };
}
async function proxyFile(fileUrl, title, res, disposition) {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error('Could not fetch file');
  const buf = Buffer.from(await response.arrayBuffer());
  const t = sniff(buf);
  const disp = (disposition === 'inline' && !t.inline) ? 'attachment' : disposition;
  const filename = (title || 'file').replace(/[^a-z0-9]/gi, '_') + '.' + t.ext;
  res.setHeader('Content-Type', t.mime);
  res.setHeader('Content-Disposition', disp + '; filename="' + filename + '"');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(buf);
}
const LOCKED = 'Locked. Subscribe to this tutor to open this assignment.';

router.get('/:id/info', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid assignment' });
    const a = await Assignment.findById(req.params.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!(await canSee(req.user, a))) return res.status(403).json({ error: LOCKED, code: 'LOCKED' });
    if (!a.file_url) return res.json({ has_file: false });
    const r = await fetch(a.file_url, { headers: { Range: 'bytes=0-65535' } });
    if (!r.ok && r.status !== 206) return res.json({ has_file: true, error: 'The file could not be reached' });
    const total = Number((r.headers.get('content-range') || '').split('/')[1]) || Number(r.headers.get('content-length')) || 0;
    const t = sniff(Buffer.from(await r.arrayBuffer()));
    res.json({ has_file: true, type: t.ext, mime: t.mime, inline: t.inline, size: total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/view', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).send('Invalid assignment');
    const a = await Assignment.findById(req.params.id);
    if (!a || !a.file_url) return res.status(404).send('File not found');
    if (!(await canSee(req.user, a))) return res.status(403).send(LOCKED);
    await proxyFile(a.file_url, a.title, res, 'inline');
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/:id/download', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid assignment' });
    const a = await Assignment.findById(req.params.id);
    if (!a || !a.file_url) return res.status(404).json({ error: 'No file' });
    if (!(await canSee(req.user, a))) return res.status(403).json({ error: LOCKED, code: 'LOCKED' });
    await proxyFile(a.file_url, a.title, res, 'attachment');
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/submissions/:id/view', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).send('Invalid submission');
    const s = await Submission.findById(req.params.id);
    if (!s || !s.file_url) return res.status(404).send('File not found');
    if (!(await canSeeSub(req.user, s))) return res.status(403).send('Not allowed');
    await proxyFile(s.file_url, 'submission_' + s._id, res, 'inline');
  } catch (e) { res.status(500).send(e.message); }
});

router.get('/submissions/:id/download', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid submission' });
    const s = await Submission.findById(req.params.id);
    if (!s || !s.file_url) return res.status(404).json({ error: 'No file' });
    if (!(await canSeeSub(req.user, s))) return res.status(403).json({ error: 'Not allowed' });
    await proxyFile(s.file_url, 'submission_' + s._id, res, 'attachment');
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, tutorOrAdmin, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid assignment' });
    const a = await Assignment.findById(req.params.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!owns(req.user, a)) return res.status(403).json({ error: 'This is not your assignment' });
    await Assignment.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/submit', auth, upload.single('file'), async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Only students can submit work' });
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid assignment' });
    const a = await Assignment.findById(req.params.id);
    if (!a) return res.status(404).json({ error: 'Assignment not found' });
    if (!(await canSee(req.user, a))) return res.status(403).json({ error: LOCKED, code: 'LOCKED' });
    const { content } = req.body;
    let file_url = '';
    if (req.file) {
      const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/submissions', 'raw');
      file_url = r.secure_url;
    }
    const existing = await Submission.findOne({ assignment_id: req.params.id, student_id: req.user._id });
    if (existing) return res.status(400).json({ error: 'Already submitted' });
    const s = await Submission.create({ assignment_id: req.params.id, student_id: req.user._id, content, file_url });
    req.app.get('io')?.to('user_' + a.tutor_id).emit('new_submission', { _id: s._id, assignment_id: a._id, student: req.user.name });
    res.status(201).json(s);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/my-submissions', auth, async (req, res) => {
  try {
    const subs = await Submission.find({ student_id: req.user._id }).populate('assignment_id');
    res.json(subs.map(s => { const o = plain(s); if (o.assignment_id) o.assignment_id.file_url = o.assignment_id.file_url ? 'protected' : ''; return o; }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/submissions', auth, tutorOrAdmin, async (req, res) => {
  try {
    let q = {};
    if (req.user.role !== 'admin') q = { assignment_id: { $in: (await Assignment.find({ tutor_id: req.user._id }).select('_id')).map(x => x._id) } };
    res.json(await Submission.find(q).populate('assignment_id').populate('student_id', 'name email'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/submissions/:id/grade', auth, tutorOrAdmin, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid submission' });
    const cur = await Submission.findById(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    if (!(await canSeeSub(req.user, cur))) return res.status(403).json({ error: 'This is not your assignment' });
    const s = await Submission.findByIdAndUpdate(req.params.id, { grade: req.body.grade, marks: req.body.marks, feedback: req.body.feedback, status: 'graded' }, { new: true });
    req.app.get('io')?.to('user_' + s.student_id).emit('assignment_graded', s);
    res.json(s);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
