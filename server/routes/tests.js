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
    const { answers, time_taken_seconds } = req.body;
    const test = await Test.findById(req.params.id);
    const questions = await Question.find({ test_id: req.params.id });
    let score = 0;
    for (const q of questions) {
      const given = (answers[q._id] || '').toString().toLowerCase().trim();
      const correct = (q.answer || '').toLowerCase().trim();
      if (given === correct) score++;
    }
    const total = questions.length;
    const percent = total > 0 ? Math.round((score / total) * 100) : 0;
    const payload = {
      answers, score, total, percent,
      subject_id: test?.subject_id,
      time_taken_seconds: time_taken_seconds || 0,
      is_mock_exam: !!test?.is_mock_exam
    };
    const existing = await Result.findOne({ test_id: req.params.id, student_id: req.user._id });
    const r = existing
      ? await Result.findByIdAndUpdate(existing._id, payload, { new: true })
      : await Result.create({ test_id: req.params.id, student_id: req.user._id, ...payload });
    res.json(r);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/tests/analytics - real performance analytics ──
router.get('/analytics/mine', auth, async (req, res) => {
  try {
    const results = await Result.find({ student_id: req.user._id }).populate('test_id', 'title subject_id duration').sort('-createdAt');
    if (!results.length) return res.json({ overall: null, bySubject: [], recent: [], trend: [] });

    const totalPercent = results.reduce((a, r) => a + (r.percent || 0), 0);
    const overall = Math.round(totalPercent / results.length);

    const subjMap = {};
    results.forEach(r => {
      const sid = r.subject_id || r.test_id?.subject_id || 0;
      if (!subjMap[sid]) subjMap[sid] = { subject_id: sid, scores: [], count: 0 };
      subjMap[sid].scores.push(r.percent || 0);
      subjMap[sid].count++;
    });
    const bySubject = Object.values(subjMap).map(s => ({
      subject_id: s.subject_id,
      average: Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length),
      attempts: s.count,
      best: Math.max(...s.scores),
      worst: Math.min(...s.scores)
    })).sort((a, b) => b.average - a.average);

    const strengths = bySubject.filter(s => s.average >= 70).slice(0, 3);
    const weaknesses = bySubject.filter(s => s.average < 60).sort((a, b) => a.average - b.average).slice(0, 3);

    const trend = results.slice(0, 10).reverse().map(r => ({
      date: r.createdAt,
      percent: r.percent,
      title: r.test_id?.title || 'Test'
    }));

    res.json({
      overall,
      totalTests: results.length,
      bySubject,
      strengths,
      weaknesses,
      trend,
      recent: results.slice(0, 5).map(r => ({
        title: r.test_id?.title || 'Test',
        percent: r.percent,
        score: r.score,
        total: r.total,
        date: r.createdAt,
        subject_id: r.subject_id || r.test_id?.subject_id
      }))
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
