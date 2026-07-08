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

// Proxy download assignment file with correct headers
router.get('/:id/download', auth, async (req, res) => {
  try {
    const a = await Assignment.findById(req.params.id);
    if (!a?.file_url) return res.status(404).json({ error: 'No file' });
    const response = await fetch(a.file_url);
    if (!response.ok) return res.status(502).json({ error: 'Could not fetch file' });
    const ext = a.file_url.includes('.pdf') ? 'pdf' : a.file_url.includes('.docx') ? 'docx' : 'bin';
    const filename = (a.title||'assignment').replace(/[^a-z0-9]/gi,'_') + '.' + ext;
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    const { Readable } = require('stream');
    Readable.fromWeb(response.body).pipe(res);
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
