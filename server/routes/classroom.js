const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { LiveClass } = require('../models');
const ClassSession = require('../models/ClassSession');
const { auth } = require('../middleware/auth');
const { studentHasAccess, tutorFeeExpiry } = require('../services/access');
const ai = require('../services/aiFallback');

const h = fn => (req, res) => fn(req, res).catch(e => { console.error('classroom:', e.message); res.status(500).json({ error: e.message }); });
const emitTo = (io, id, ev, d) => io && io.to('class_' + id).emit(ev, d);
const strip = ({ correct_answer, explanation, ...rest }) => rest;
const num = v => (Number.isFinite(+v) && +v > 0 && +v < 1e6) ? +v : null;
const dur = t => Math.max(5000, String(t).split(/\s+/).length * 480 + 1500);

async function load(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid class' });
    const cls = await LiveClass.findById(req.params.id);
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    const u = req.user; let ok;
    if (u.role === 'admin') ok = true; else if (u.role === 'tutor') ok = !!u.approved;
    else ok = !!cls.tutor_id && await studentHasAccess(u._id, cls.tutor_id, cls.subject_id);
    if (!ok) return res.status(403).json({ error: 'Locked. Subscribe to this tutor to join.', code: 'LOCKED' });
    req.cls = cls;
    req.isController = u.role === 'admin' || (u.role === 'tutor' && !!u.approved && String(cls.tutor_id) === String(u._id));
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
}
const control = (req, res, next) => req.isController ? next() : res.status(403).json({ error: 'Only the class teacher can do this' });

async function session(cls) {
  const q = { class_id: cls._id };
  try { return await ClassSession.findOneAndUpdate(q, { $setOnInsert: { status: 'draft', topic: cls.lesson_topic || '' } }, { upsert: true, new: true }); }
  catch (e) { if (e.code === 11000) return ClassSession.findOne(q); throw e; }
}

function cleanBoard(b, text) {
  b = b && typeof b === 'object' ? b : {};
  const d = b.diagram && typeof b.diagram === 'object' ? b.diagram : {};
  let diagram = null;
  if (d.type === 'triangle' && num(d.base) && num(d.height)) diagram = { type: 'triangle', base: +d.base, height: +d.height };
  else if (d.type === 'rectangle' && num(d.width) && num(d.height)) diagram = { type: 'rectangle', width: +d.width, height: +d.height };
  else if (d.type === 'circle' && num(d.radius)) diagram = { type: 'circle', radius: +d.radius };
  return { heading: String(b.heading || String(text).split(/\s+/).slice(0, 4).join(' ')).slice(0, 60),
    points: (Array.isArray(b.points) ? b.points : []).slice(0, 3).map(p => String(p).slice(0, 120)),
    formula: String(b.formula || '').slice(0, 80), diagram };
}

function toChunks(raw) {
  const out = [];
  for (let p of String(raw || '').replace(/```[a-z]*/gi, '').split(/\n\s*\n/)) {
    p = p.replace(/^[\s#*\->\d.)]+/, '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
    if (p.length < 20) continue;
    if (p.length <= 450) { out.push(p); continue; }
    let cur = '';
    for (const s of p.split(/(?<=[.!?])\s+/)) { if ((cur + ' ' + s).length > 400 && cur) { out.push(cur.trim()); cur = s; } else cur += ' ' + s; }
    if (cur.trim().length >= 20) out.push(cur.trim());
  }
  return out.slice(0, 26);
}

async function buildLesson(subject, topic, notes) {
  const src = String(notes || '').trim().slice(0, 9000);
  const sys = `You are Teacher Ken, a warm, expert teacher for Zambian students preparing for ECZ and GCE exams. Deliver one complete spoken lesson on "${topic || subject}" (Subject: ${subject}).
${src ? 'Teaching notes to build the lesson from. Cover EVERY point in them and explain each clearly:\n' + src : 'No notes were given. Use the Zambian ECZ syllabus.'}
Write plain speech in paragraphs separated by one blank line. 14 to 20 paragraphs, each 2 to 3 short spoken sentences. Start with a friendly welcome and what we will learn. Explain step by step, simple to harder, with Zambian examples (kwacha, markets, minibuses, nshima, farms). Include one fully worked example with real numbers. Include one common exam mistake and one exam tip. End with a short recap. Never ask the student a question. No headings, bullets, numbering or markdown. Never mention AI or computers.`;
  for (let i = 0; i < 2; i++) {
    const raw = String(await ai.callAI(sys, 'Teach the full lesson now.', [], 3500));
    if (/ask again in a moment/i.test(raw)) continue;
    const parts = toChunks(raw); if (parts.length >= 3) return parts;
  }
  throw new Error('The AI could not build the lesson. Please try again in a moment.');
}

async function planBoards(texts, subject, pics = [], tbls = []) {
  const sys = `You plan whiteboard content for a spoken lesson. Subject: ${subject}. Reply with ONLY a JSON array of exactly ${texts.length} objects, one per numbered paragraph: {"heading":"2-5 words","points":["up to 3 short lines"],"formula":"optional plain text e.g. A = 1/2 x b x h","diagram":null or {"type":"triangle","base":12,"height":7} or {"type":"rectangle","width":8,"height":5} or {"type":"circle","radius":7}}. Add a diagram ONLY when the paragraph states those numbers. Never invent facts.`;
  try {
    const extra = pics.length ? ' The teacher also has these pictures from the uploaded PDF: ' + pics.map((p, i) => (i + 1) + '. ' + (p.caption || 'a diagram')).join('; ') + '. In each object also add "image": the number of the ONE picture that belongs with that paragraph, or null. Use each picture at most once and only when the paragraph is clearly about it.' : '';
    const extraT = tbls.length ? ' The teacher also has these tables from the PDF: ' + tbls.map((t, i) => (i + 1) + '. columns: ' + String((t.rows[0] || []).join(', ')).slice(0, 80)).join('; ') + '. In each object also add "table": the number of the ONE table that belongs with that paragraph, or null. Use each table at most once and only when the paragraph is clearly about it.' : '';
    const raw = await ai.callAI(sys + extra + extraT, texts.map((t, i) => `${i + 1}. ${t}`).join('\n'), [], 3500);
    const m = String(raw).match(/\[[\s\S]*\]/); const arr = m ? JSON.parse(m[0]) : null;
    if (Array.isArray(arr) && arr.length === texts.length) return arr.map((b, i) => { const o = cleanBoard(b, texts[i]); const k = Number(b && b.image); if (pics.length && Number.isInteger(k) && pics[k - 1] && pics[k - 1].url) o.image = pics[k - 1].url; const tk = Number(b && b.table); if (tbls.length && Number.isInteger(tk) && tbls[tk - 1] && tbls[tk - 1].rows) o.table = tbls[tk - 1].rows; return o; });
  } catch (e) { console.error('board plan:', e.message); }
  return texts.map(t => cleanBoard({}, t));
}

// ---- the server runs the lesson ----
async function setSection(io, s, i) {
  const c = s.chunks[i];
  await ClassSession.updateOne({ _id: s._id }, { index: i, 'run.section_end': new Date(Date.now() + dur(c.text)), board_state: { board: c.board, text: c.text, index: i, total: s.chunks.length, at: new Date() } });
  console.log('classroom section', String(s.class_id), (i + 1) + '/' + s.chunks.length);
  emitTo(io, s.class_id, 'cr_state', { index: i, total: s.chunks.length, chunk: c });
}
async function tick(io) {
  const live = await ClassSession.find({ status: 'live', 'run.playing': true });
  for (const s of live) {
    if (!s.run.section_end || Date.now() < +s.run.section_end) continue;
    if (s.index + 1 < s.chunks.length) await setSection(io, s, s.index + 1);
    else { await ClassSession.updateOne({ _id: s._id }, { 'run.playing': false, 'run.done': true, 'run.done_at': new Date() }); emitTo(io, s.class_id, 'cr_playback', { playing: false }); }
  }
}
let timer = null;
router.use((req, res, next) => { if (!timer) timer = setInterval(() => tick(req.app.get('io')).catch(e => console.error('tick:', e.message)), 2000); next(); });

function view(req, s) {
  const c = req.cls, me = String(req.user._id);
  const chunks = (req.isController || s.status === 'ended') ? s.chunks : [];
  const last = s.quizzes[s.quizzes.length - 1];
  const quiz = (c.status === 'live' && last) ? { quizId: last._id, answered: last.results.some(r => r.user_id === me), questions: last.questions.map(strip) } : null;
  return { controller: req.isController, me: { _id: me, name: req.user.name },
    class: { _id: c._id, title: c.title, status: c.status, lesson_topic: c.lesson_topic },
    session: { status: s.status, index: s.index, total: s.chunks.length, chunks }, current: s.status === 'live' ? (s.chunks[s.index] || null) : null,
    run: { playing: !!(s.run && s.run.playing), done: !!(s.run && s.run.done) }, quiz, board: s.board_state || null,
    images: (s.images || []).map(i => ({ url: i.url, caption: i.caption })),
    attendees: req.isController ? s.attendance.map(a => ({ _id: a.user_id, name: a.name })) : undefined };
}

router.get('/:id/state', auth, load, h(async (req, res) => {
  await tick(req.app.get('io'));
  const s = await session(req.cls), uid = String(req.user._id);
  if (!req.isController && req.cls.status === 'live') {
    await ClassSession.updateOne({ _id: s._id, 'attendance.user_id': { $ne: uid } }, { $push: { attendance: { user_id: uid, name: req.user.name, joined_at: new Date(), last_seen: new Date() } } });
    await ClassSession.updateOne({ _id: s._id, 'attendance.user_id': uid }, { $set: { 'attendance.$.last_seen': new Date() } });
  }
  res.json(view(req, s));
}));
router.post('/:id/ping', auth, load, h(async (req, res) => res.json({ ok: true })));

const starting = new Set();
const TZ = process.env.CLASS_TZ_OFFSET || '+02:00';

async function prepareLesson(cls, o = {}) {
  const subject = String(o.subject || cls.subject_name || cls.lesson_topic || cls.title || 'General'), topic = String(o.topic || cls.lesson_topic || ''), notes = o.notes || cls.lesson_script || '';
  const texts = await buildLesson(subject, topic, notes);
  const pics = (cls.lesson_diagrams || []).filter(d => d && d.url).slice(0, 8).map(d => ({ url: d.url, caption: d.caption }));
  const tbls = (cls.lesson_tables || []).filter(t => t && Array.isArray(t.rows)).slice(0, 6);
  const boards = await planBoards(texts, subject, pics, tbls);
  const s = await session(cls);
  await ClassSession.updateOne({ _id: s._id }, { chunks: texts.map((t, i) => ({ text: t, board: boards[i] })), status: 'ready', index: 0, topic, subject });
  return texts.length;
}
async function goLive(io, cls, auto) {
  const s = await session(cls);
  await ClassSession.updateOne({ _id: s._id }, { status: 'live', index: 0, started_at: new Date(), ended_at: null, 'run.playing': true, 'run.done': false, 'run.auto': !!auto, 'run.done_at': null });
  const c = await LiveClass.findByIdAndUpdate(cls._id, { status: 'live' }, { new: true });
  io && io.emit('class_went_live', { _id: c._id, title: c.title, subject_id: c.subject_id, tutor_id: c.tutor_id });
  emitTo(io, c._id, 'class_status_change', { status: 'live', classId: String(c._id) });
  await setSection(io, await ClassSession.findById(s._id), 0);
}

router.post('/:id/run', auth, load, control, h(async (req, res) => {
  const io = req.app.get('io'), id = String(req.cls._id), s = await session(req.cls);
  if ((s.status === 'live' && s.run && s.run.section_end) || starting.has(id)) return res.json({ ok: true, already: true });
  if (req.user.role === 'tutor' && !(await tutorFeeExpiry(req.user._id))) return res.status(402).json({ error: 'K20 monthly fee unpaid. Pay it to start classes.', code: 'TUTOR_FEE_REQUIRED' });
  starting.add(id);
  try {
    if (!(s.status === 'ready' && s.chunks.length)) await prepareLesson(req.cls, { subject: req.body.subject, topic: req.body.topic, notes: req.body.notes });
    await goLive(io, req.cls, false);
  } finally { starting.delete(id); }
  res.json({ ok: true });
}));

function startScheduler(app) {
  if (startScheduler.on) return; startScheduler.on = true;
  const sweep = async () => {
    const io = app.get('io'), now = Date.now();
    try {
      const list = await LiveClass.find({ presenter_type: 'ai', status: { $in: ['upcoming', 'live'] } }).lean();
      for (const c of list) {
        if (c.auto_start !== true || !c.scheduled_date || !c.scheduled_time) continue;
        const at = new Date(`${c.scheduled_date}T${String(c.scheduled_time).slice(0, 5)}:00${TZ}`).getTime(), id = String(c._id);
        if (!Number.isFinite(at) || starting.has(id)) continue;
        if (now < at - 10 * 60000 || now > at + (c.status === 'live' ? 120 : 30) * 60000) continue;
        const cls = await LiveClass.findById(c._id); if (!cls) continue;
        const s = await session(cls);
        if (s.status === 'live' || s.status === 'ended') continue;
        const tries = (s.run && s.run.tries) || 0;
        if (tries >= 4 || (s.run && s.run.last_try && now - +s.run.last_try < 60000)) continue;
        starting.add(id); let claimed = false;
        try {
          await ClassSession.updateOne({ _id: s._id }, { $inc: { 'run.tries': 1 }, $set: { 'run.last_try': new Date() } });
          if (!(s.status === 'ready' && s.chunks.length)) { console.log('auto: preparing', cls.title); await prepareLesson(cls); }
          if (now >= at || cls.status === 'live') {
            if (!(await tutorFeeExpiry(cls.tutor_id))) { console.log('auto: tutor fee unpaid, not starting', cls.title); await ClassSession.updateOne({ _id: s._id }, { $set: { 'run.tries': 99, 'run.last_error': 'Tutor fee unpaid' } }); continue; }
            if (cls.status === 'upcoming') { claimed = !!(await LiveClass.findOneAndUpdate({ _id: cls._id, status: 'upcoming' }, { status: 'live' })); if (!claimed) continue; }
            console.log('auto: starting', cls.title); await goLive(io, cls, true);
          }
        } catch (e) {
          console.error('auto-start failed:', e.message);
          await ClassSession.updateOne({ _id: s._id }, { $set: { 'run.last_error': String(e.message).slice(0, 200) } });
          if (claimed) await LiveClass.updateOne({ _id: cls._id }, { status: 'upcoming' });
        } finally { starting.delete(id); }
      }
      const fin = await ClassSession.find({ status: 'live', 'run.auto': true, 'run.done': true, 'run.done_at': { $lt: new Date(now - 10 * 60000) } });
      for (const s of fin) {
        await ClassSession.updateOne({ _id: s._id }, { status: 'ended', ended_at: new Date(), 'run.playing': false });
        await LiveClass.findByIdAndUpdate(s.class_id, { status: 'ended' });
        emitTo(io, s.class_id, 'class_status_change', { status: 'ended', classId: String(s.class_id) });
        console.log('auto: ended class', String(s.class_id));
      }
    } catch (e) { console.error('scheduler:', e.message); }
  };
  setInterval(sweep, 20000);
  console.log('⏰ Class scheduler running (times are read as UTC' + TZ + ')');
}
router.startScheduler = startScheduler;

router.post('/:id/playback', auth, load, control, h(async (req, res) => {
  const io = req.app.get('io'), s = await session(req.cls), a = req.body.action;
  if (s.status !== 'live') return res.status(409).json({ error: 'Class is not live' });
  if (a === 'pause') { await ClassSession.updateOne({ _id: s._id }, { 'run.playing': false }); emitTo(io, s.class_id, 'cr_playback', { playing: false }); }
  else if (a === 'resume') { await ClassSession.updateOne({ _id: s._id }, { 'run.playing': true, 'run.done': false, 'run.section_end': new Date(Date.now() + dur((s.chunks[s.index] || {}).text || '')) }); emitTo(io, s.class_id, 'cr_playback', { playing: true }); }
  else if (a === 'next' || a === 'prev') { const i = Math.max(0, Math.min(s.chunks.length - 1, s.index + (a === 'next' ? 1 : -1))); await setSection(io, s, i); }
  res.json({ ok: true });
}));

router.post('/:id/image', auth, load, control, h(async (req, res) => {
  const url = String(req.body.url || '');
  if (!/^https:\/\/\S+$/i.test(url) || url.length > 600) return res.status(400).json({ error: 'Invalid picture link' });
  const s = await session(req.cls);
  await ClassSession.updateOne({ _id: s._id }, { $push: { images: { url, caption: String(req.body.caption || '').slice(0, 120), at: new Date() } } });
  emitTo(req.app.get('io'), req.cls._id, 'cr_image', { url, caption: req.body.caption || '' });
  res.json({ ok: true });
}));

router.post('/:id/question', auth, load, h(async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 500);
  if (text.length < 3) return res.status(400).json({ error: 'Type your question' });
  const io = req.app.get('io'), s = await session(req.cls);
  if (req.cls.status !== 'live') return res.status(409).json({ error: 'The class is not live' });
  const id = new mongoose.Types.ObjectId(), name = req.user.name;
  await ClassSession.updateOne({ _id: s._id }, { $push: { questions: { _id: id, user_id: String(req.user._id), name, text, at_index: s.index } } });
  emitTo(io, req.cls._id, 'cr_question', { _id: id, name, text });
  const sys = `You are Teacher Ken, a warm teacher for Zambian ECZ and GCE students. Answer in plain speech, no markdown or lists, 60 to 120 words, with one short example. Work calculations step by step and check them. Lesson topic: ${s.topic || req.cls.title}. The lesson is currently saying: ${String((s.chunks[s.index] || {}).text || '').slice(0, 400)}`;
  let answer;
  try { answer = String(await ai.callAI(sys, text, [], 450)).replace(/[*_#`]/g, '').trim(); if (/ask again in a moment/i.test(answer)) throw new Error('AI busy'); }
  catch (e) { return res.status(502).json({ error: 'Mr Ken could not answer right now. Please try again.' }); }
  await ClassSession.updateOne({ _id: s._id, 'questions._id': id }, { $set: { 'questions.$.answer': answer } });
  await ClassSession.updateOne({ _id: s._id, 'run.playing': true }, { 'run.section_end': new Date(Math.max(Date.now(), +(s.run && s.run.section_end || 0)) + dur(answer)) });
  emitTo(io, req.cls._id, 'cr_answer', { _id: id, name, question: text, text: answer });
  res.json({ _id: id, answer });
}));

router.post('/:id/hand', auth, load, h(async (req, res) => {
  const raised = !!req.body.raised, uid = String(req.user._id);
  if (raised) await ClassSession.updateOne({ class_id: req.cls._id }, { $push: { hands: { user_id: uid, name: req.user.name, at: new Date() } } });
  emitTo(req.app.get('io'), req.cls._id, 'cr_hand', { userId: uid, name: req.user.name, raised });
  res.json({ ok: true });
}));

router.post('/:id/quiz', auth, load, control, h(async (req, res) => {
  const qs = (req.body.questions || []).slice(0, 10).filter(x => x && x.question && Array.isArray(x.options) && x.options.length >= 2 && x.correct_answer)
    .map(x => ({ question: String(x.question).slice(0, 300), options: x.options.slice(0, 5).map(o => String(o).slice(0, 150)), correct_answer: String(x.correct_answer).trim().charAt(0).toUpperCase(), explanation: String(x.explanation || '').slice(0, 300) }));
  if (!qs.length) return res.status(400).json({ error: 'No valid questions' });
  const s = await session(req.cls), id = new mongoose.Types.ObjectId();
  await ClassSession.updateOne({ _id: s._id }, { $push: { quizzes: { _id: id, questions: qs, results: [], at: new Date() } } });
  emitTo(req.app.get('io'), req.cls._id, 'cr_quiz', { quizId: id, questions: qs.map(strip) });
  res.json({ quizId: id, count: qs.length });
}));

router.post('/:id/quiz/:qid/answer', auth, load, h(async (req, res) => {
  if (req.isController) return res.status(403).json({ error: 'Students answer quizzes' });
  const s = await session(req.cls), q = s.quizzes.id(req.params.qid);
  if (!q) return res.status(404).json({ error: 'Quiz not found' });
  const ans = req.body.answers || {}, uid = String(req.user._id);
  const review = q.questions.map((x, i) => ({ yours: String(ans[i] || '').trim().charAt(0).toUpperCase(), correct: x.correct_answer, explanation: x.explanation || '' }));
  const score = review.filter(r => r.yours && r.yours === r.correct).length;
  const r = await ClassSession.updateOne({ _id: s._id, quizzes: { $elemMatch: { _id: q._id, 'results.user_id': { $ne: uid } } } },
    { $push: { 'quizzes.$.results': { user_id: uid, name: req.user.name, score, total: review.length, answers: ans, at: new Date() } } });
  if (!r.modifiedCount) return res.status(409).json({ error: 'You already answered this quiz' });
  emitTo(req.app.get('io'), req.cls._id, 'cr_quiz_progress', { quizId: q._id, name: req.user.name });
  res.json({ score, total: review.length, review });
}));

router.post('/:id/end', auth, load, control, h(async (req, res) => {
  const s = await session(req.cls);
  await ClassSession.updateOne({ _id: s._id }, { status: 'ended', ended_at: new Date(), 'run.playing': false });
  await LiveClass.findByIdAndUpdate(req.cls._id, { status: 'ended' });
  emitTo(req.app.get('io'), req.cls._id, 'class_status_change', { status: 'ended', classId: String(req.cls._id) });
  res.json({ ok: true });
}));

router.get('/:id/report', auth, load, h(async (req, res) => {
  const s = (await session(req.cls)).toObject(), me = String(req.user._id);
  const secName = i => { const c = s.chunks[i] || {}; return String((c.board && c.board.heading) || String(c.text || '').split(/\s+/).slice(0, 5).join(' ') || ('Section ' + (i + 1))).slice(0, 60); };
  if (!req.isController) return res.json({
    status: s.status, attended: s.attendance.some(a => a.user_id === me),
    questions: s.questions.filter(q => q.user_id === me).map(q => ({ text: q.text, answer: q.answer, section: secName(q.at_index) })),
    quizzes: s.quizzes.map((q, i) => { const r = (q.results || []).find(x => x.user_id === me); return r ? { n: i + 1, score: r.score, total: r.total } : null; }).filter(Boolean) });
  const perSection = {};
  s.questions.forEach(q => { const k = secName(q.at_index); perSection[k] = (perSection[k] || 0) + 1; });
  res.json({
    status: s.status, title: req.cls.title, started_at: s.started_at, ended_at: s.ended_at, hands: s.hands.length, total_sections: s.chunks.length,
    attendance: s.attendance.map(a => ({ _id: a.user_id, name: a.name, joined_at: a.joined_at, minutes: Math.max(0, Math.round((new Date(a.last_seen || a.joined_at) - new Date(a.joined_at)) / 60000)) })),
    questions: s.questions.map(q => ({ name: q.name, text: q.text, answer: q.answer, section: secName(q.at_index) })),
    hard_sections: Object.entries(perSection).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([section, count]) => ({ section, count })),
    quizzes: s.quizzes.map((q, qi) => {
      const rs = q.results || [];
      return { n: qi + 1, taken: rs.length,
        average: rs.length ? Math.round(rs.reduce((acc, r) => acc + r.score / (r.total || 1), 0) / rs.length * 100) : null,
        results: rs.map(({ user_id, name, score, total }) => ({ user_id, name, score, total })),
        hardest: (q.questions || []).map((qq, i) => ({ question: String(qq.question).slice(0, 100), correct_pct: rs.length ? Math.round(rs.filter(r => String((r.answers || {})[i] || '').trim().charAt(0).toUpperCase() === qq.correct_answer).length / rs.length * 100) : null })).sort((x, y) => (x.correct_pct === null ? 101 : x.correct_pct) - (y.correct_pct === null ? 101 : y.correct_pct)).slice(0, 3) };
    }) });
}));

module.exports = router;
