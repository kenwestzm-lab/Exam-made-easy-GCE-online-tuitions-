const express = require('express');
const router = express.Router();
const { Assignment, Submission } = require('../models');
const { auth, tutorOrAdmin } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../config/cloudinary');

router.get('/', auth, async (req, res) => {
  try { res.json(await Assignment.find().sort('-createdAt')); }
  catch(e) { res.status(500).json({ error: e.message }); }
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
    req.app.get('io')?.emit('new_assignment', a);
    res.status(201).json(a);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Detect real file type from Cloudinary's own response header rather than guessing from URL
async function proxyFile(fileUrl, title, res, disposition) {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error('Could not fetch file');
  let mime = response.headers.get('content-type') || '';
  // Cloudinary raw uploads often report octet-stream even for real PDFs — sniff the actual bytes.
  const buf = Buffer.from(await response.arrayBuffer());
  const isPdf = buf.slice(0, 5).toString('utf8') === '%PDF-';
  if (isPdf) mime = 'application/pdf';
  else if (!mime || mime === 'application/octet-stream') mime = 'application/octet-stream';
  const ext = isPdf ? 'pdf' : (fileUrl.includes('.docx') ? 'docx' : (mime.includes('word') ? 'docx' : 'bin'));
  const filename = (title || 'file').replace(/[^a-z0-9]/gi, '_') + '.' + ext;
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', disposition + '; filename="' + filename + '"');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(buf);
}

// Proxy VIEW - renders assignment PDF inline in browser
router.get('/:id/view', auth, async (req, res) => {
  try {
    const a = await Assignment.findById(req.params.id);
    if (!a?.file_url) return res.status(404).send('File not found');
    await proxyFile(a.file_url, a.title, res, 'inline');
  } catch(e) { res.status(500).send(e.message); }
});

// Proxy download assignment file with correct headers
router.get('/:id/download', auth, async (req, res) => {
  try {
    const a = await Assignment.findById(req.params.id);
    if (!a?.file_url) return res.status(404).json({ error: 'No file' });
    await proxyFile(a.file_url, a.title, res, 'attachment');
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Proxy VIEW - renders a student's submitted file inline (for tutors grading)
router.get('/submissions/:id/view', auth, async (req, res) => {
  try {
    const s = await Submission.findById(req.params.id);
    if (!s?.file_url) return res.status(404).send('File not found');
    await proxyFile(s.file_url, 'submission_' + s._id, res, 'inline');
  } catch(e) { res.status(500).send(e.message); }
});

// Proxy DOWNLOAD - a student's submitted file
router.get('/submissions/:id/download', auth, async (req, res) => {
  try {
    const s = await Submission.findById(req.params.id);
    if (!s?.file_url) return res.status(404).json({ error: 'No file' });
    await proxyFile(s.file_url, 'submission_' + s._id, res, 'attachment');
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, tutorOrAdmin, async (req, res) => {
  try { await Assignment.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/submit', auth, upload.single('file'), async (req, res) => {
  try {
    const { content } = req.body;
    let file_url = '';
    if (req.file) {
      const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/submissions', 'raw');
      file_url = r.secure_url;
    }
    const existing = await Submission.findOne({ assignment_id: req.params.id, student_id: req.user._id });
    if (existing) return res.status(400).json({ error: 'Already submitted' });
    const s = await Submission.create({ assignment_id: req.params.id, student_id: req.user._id, content, file_url });
    res.status(201).json(s);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/my-submissions', auth, async (req, res) => {
  try { res.json(await Submission.find({ student_id: req.user._id }).populate('assignment_id')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/submissions', auth, tutorOrAdmin, async (req, res) => {
  try { res.json(await Submission.find().populate('assignment_id').populate('student_id','name email')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/submissions/:id/grade', auth, tutorOrAdmin, async (req, res) => {
  try {
    const s = await Submission.findByIdAndUpdate(req.params.id, { grade: req.body.grade, marks: req.body.marks, feedback: req.body.feedback, status: 'graded' }, { new: true });
    res.json(s);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
