const express = require('express');
const router = express.Router();
const { Test, Question, Result } = require('../models');
const { auth, tutorOrAdmin } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try { res.json(await Test.find().sort('-createdAt')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, tutorOrAdmin, async (req, res) => {
  try {
    const t = await Test.create({ ...req.body, subject_id: Number(req.body.subject_id), tutor_id: req.user._id });
    res.status(201).json(t);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, tutorOrAdmin, async (req, res) => {
  try { await Test.findByIdAndDelete(req.params.id); await Question.deleteMany({ test_id: req.params.id }); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/questions', auth, async (req, res) => {
  try { res.json(await Question.find()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/questions', auth, tutorOrAdmin, async (req, res) => {
  try {
    const q = await Question.create({ ...req.body, test_id: req.params.id });
    res.status(201).json(q);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/results', auth, async (req, res) => {
  try { res.json(await Result.find({ student_id: req.user._id })); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/submit', auth, async (req, res) => {
  try {
    const { answers } = req.body;
    const questions = await Question.find({ test_id: req.params.id });
    let score = 0;
    for (const q of questions) {
      const given = (answers[q._id] || '').toString().toLowerCase().trim();
      const correct = (q.answer || '').toLowerCase().trim();
      if (given === correct) score++;
    }
    const total = questions.length;
    const percent = total > 0 ? Math.round((score / total) * 100) : 0;
    const existing = await Result.findOne({ test_id: req.params.id, student_id: req.user._id });
    const r = existing
      ? await Result.findByIdAndUpdate(existing._id, { answers, score, total, percent }, { new: true })
      : await Result.create({ test_id: req.params.id, student_id: req.user._id, answers, score, total, percent });
    res.json(r);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
