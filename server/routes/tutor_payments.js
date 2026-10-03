const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { User } = require('../models');
const { PayInfo, TutorPayment, TutorAccess, TutorFee } = require('../models/tutorpay');
const { auth, adminOnly } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../config/cloudinary');
const { tutorFeeExpiry, addMonths } = require('../services/access');

const FEE_AMOUNT = 20;
const PAY_NAME = process.env.PLATFORM_PAY_NAME || 'Peace Mindset School';
const PLATFORM_METHODS = [
  { method: 'MTN Mobile Money', account_name: PAY_NAME, account_number: '0761468402' },
  { method: 'Airtel Money',     account_name: PAY_NAME, account_number: '0570109056' },
  { method: 'Access Bank',      account_name: PAY_NAME, account_number: '0136496126029' },
];
const isId = (v) => mongoose.isValidObjectId(v);
const str = (v, n = 200) => String(v || '').trim().slice(0, n);
const uploadReceipt = async (f) => f ? (await uploadToCloudinary(f.buffer, 'peace-mindset/receipts', 'image')).secure_url : '';
const studentOnly = (req, res, next) => req.user.role === 'student' ? next() : res.status(403).json({ error: 'Students only' });
const tutorOnly = (req, res, next) =>
  (req.user.role === 'tutor' && req.user.approved) ? next() : res.status(403).json({ error: 'Approved tutors only' });
const months = (v) => Math.min(Math.max(parseInt(v) || 1, 1), 12);

// ───────── TUTOR: payment details ─────────
router.get('/my-details', auth, tutorOnly, async (req, res) => {
  try { res.json(await PayInfo.findOne({ tutor_id: req.user._id }) || null); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/my-details', auth, tutorOnly, async (req, res) => {
  try {
    const price = Number(req.body.price_per_month);
    if (!(price > 0)) return res.status(400).json({ error: 'Enter a valid monthly price' });
    const list = Array.isArray(req.body.methods) ? req.body.methods.slice(0, 6) : [];
    const methods = list.map(m => ({
      method: str(m.method, 40), account_name: str(m.account_name, 80),
      account_number: str(m.account_number, 60), instructions: str(m.instructions, 300)
    })).filter(m => m.method && m.account_number && m.account_name);
    if (!methods.length) return res.status(400).json({ error: 'Add at least one payment method with name and number' });
    const info = await PayInfo.findOneAndUpdate(
      { tutor_id: req.user._id },
      { tutor_id: req.user._id, price_per_month: price, methods, active: req.body.active !== false,
        ...(Array.isArray(req.body.subjects) ? { subjects: req.body.subjects.map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 20) } : {}) },
      { upsert: true, new: true, runValidators: true }
    );
    res.json(info);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────── STUDENT: choose tutor, see details, submit ─────────
router.get('/tutors', auth, async (req, res) => {
  try {
    const infos = await PayInfo.find({ active: true });
    const tutors = await User.find({ _id: { $in: infos.map(i => i.tutor_id) }, role: 'tutor', approved: true })
      .select('name avatarUrl avatar bio');
    const price = new Map(infos.map(i => [String(i.tutor_id), i.price_per_month]));
    const subj = new Map(infos.map(i => [String(i.tutor_id), i.subjects || []]));
    res.json(tutors.map(t => ({ _id: t._id, name: t.name, avatarUrl: t.avatarUrl, avatar: t.avatar, bio: t.bio, price_per_month: price.get(String(t._id)), subjects: subj.get(String(t._id)) || [] })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/tutors/:id/details', auth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid tutor' });
    const tutor = await User.findOne({ _id: req.params.id, role: 'tutor', approved: true }).select('name');
    const info = await PayInfo.findOne({ tutor_id: req.params.id, active: true });
    if (!tutor || !info) return res.status(404).json({ error: 'This tutor has not set up payment details yet' });
    res.json({ tutor: { _id: tutor._id, name: tutor.name }, price_per_month: info.price_per_month, subjects: info.subjects || [], methods: info.methods });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/submit', auth, studentOnly, upload.single('receipt'), async (req, res) => {
  try {
    const { tutor_id, method } = req.body;
    const m = months(req.body.months);
    const txn = str(req.body.transaction_id, 60).toUpperCase();
    if (!isId(tutor_id) || !txn || !method) return res.status(400).json({ error: 'Tutor, payment method and reference number are required' });
    const tutor = await User.findOne({ _id: tutor_id, role: 'tutor', approved: true });
    const info = await PayInfo.findOne({ tutor_id, active: true });
    if (!tutor || !info) return res.status(404).json({ error: 'This tutor is not accepting payments yet' });
    if (!info.methods.some(x => x.method === method)) return res.status(400).json({ error: 'Invalid payment method for this tutor' });
    const expected = info.price_per_month * m;
    const amount = Number(req.body.amount);
    if (!(amount >= expected)) return res.status(400).json({ error: `Amount must be at least K${expected} for ${m} month(s)` });
    if (await TutorPayment.exists({ student_id: req.user._id, tutor_id, status: 'pending' }))
      return res.status(409).json({ error: 'You already have a pending payment for this tutor. Wait for approval.' });
    const receipt_url = await uploadReceipt(req.file);
    let p;
    try {
      p = await TutorPayment.create({ student_id: req.user._id, tutor_id, amount, months: m, method, transaction_id: txn, receipt_url });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: 'This reference number was already submitted' });
      throw e;
    }
    req.app.get('io')?.to('user_' + tutor_id).emit('new_tutor_payment', { _id: p._id, student: req.user.name, amount, months: m });
    res.status(201).json(p);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/mine', auth, studentOnly, async (req, res) => {
  try { res.json(await TutorPayment.find({ student_id: req.user._id }).populate('tutor_id', 'name').sort('-createdAt')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/access/mine', auth, studentOnly, async (req, res) => {
  try {
    const now = new Date();
    const list = await TutorAccess.find({ student_id: req.user._id }).populate('tutor_id', 'name');
    res.json(list.map(a => ({ tutor: a.tutor_id, expires_at: a.expires_at, active: a.expires_at > now, server_time: now })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────── TUTOR: review payments ─────────
router.get('/incoming', auth, tutorOnly, async (req, res) => {
  try { res.json(await TutorPayment.find({ tutor_id: req.user._id }).populate('student_id', 'name email phone grade').sort('-createdAt')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/my-students', auth, tutorOnly, async (req, res) => {
  try {
    res.json(await TutorAccess.find({ tutor_id: req.user._id, expires_at: { $gt: new Date() } })
      .populate('student_id', 'name email phone grade').sort('expires_at'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/approve', auth, tutorOnly, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid payment' });
    // Atomic: only a pending payment owned by THIS tutor can be approved, and only once
    const p = await TutorPayment.findOneAndUpdate(
      { _id: req.params.id, tutor_id: req.user._id, status: 'pending' },
      { status: 'approved', reviewed_at: new Date(), note: str(req.body.note, 300) },
      { new: true }
    );
    if (!p) return res.status(404).json({ error: 'Payment not found or already reviewed' });
    const now = new Date();
    const cur = await TutorAccess.findOne({ student_id: p.student_id, tutor_id: p.tutor_id });
    const start = cur && cur.expires_at > now ? cur.expires_at : now; // renewal adds to remaining time
    const exp = addMonths(start, p.months);
    await TutorAccess.findOneAndUpdate(
      { student_id: p.student_id, tutor_id: p.tutor_id },
      { expires_at: exp, expiry_notified: false, last_payment_id: p._id },
      { upsert: true, new: true }
    );
    await TutorPayment.updateOne({ _id: p._id }, { expires_at: exp });
    req.app.get('io')?.to('user_' + p.student_id).emit('access_granted', { tutor_id: p.tutor_id, tutor_name: req.user.name, expires_at: exp });
    res.json({ ...p.toObject(), expires_at: exp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/reject', auth, tutorOnly, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid payment' });
    const p = await TutorPayment.findOneAndUpdate(
      { _id: req.params.id, tutor_id: req.user._id, status: 'pending' },
      { status: 'rejected', reviewed_at: new Date(), note: str(req.body.note, 300) },
      { new: true }
    );
    if (!p) return res.status(404).json({ error: 'Payment not found or already reviewed' });
    req.app.get('io')?.to('user_' + p.student_id).emit('payment_rejected', { tutor_id: p.tutor_id, note: p.note });
    res.json(p);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────── TUTOR: K20 monthly fee (approved by ADMIN) ─────────
router.get('/fee/status', auth, tutorOnly, async (req, res) => {
  try {
    const exp = await tutorFeeExpiry(req.user._id);
    const pending = await TutorFee.exists({ tutor_id: req.user._id, status: 'pending' });
    res.json({
      paid: !!exp, expires_at: exp, amount: FEE_AMOUNT, pending: !!pending, server_time: new Date(),
      pay_to: PLATFORM_METHODS
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/fee/submit', auth, tutorOnly, upload.single('receipt'), async (req, res) => {
  try {
    const m = months(req.body.months);
    const txn = str(req.body.transaction_id, 60).toUpperCase();
    if (!txn || !req.body.method) return res.status(400).json({ error: 'Payment method and reference number are required' });
    if (!PLATFORM_METHODS.some(x => x.method === req.body.method)) return res.status(400).json({ error: 'Choose MTN Mobile Money, Airtel Money or Access Bank' });
    if (!(Number(req.body.amount) >= FEE_AMOUNT * m)) return res.status(400).json({ error: `Amount must be at least K${FEE_AMOUNT * m}` });
    if (await TutorFee.exists({ tutor_id: req.user._id, status: 'pending' }))
      return res.status(409).json({ error: 'You already have a fee payment awaiting admin approval' });
    const receipt_url = await uploadReceipt(req.file);
    let f;
    try {
      f = await TutorFee.create({ tutor_id: req.user._id, amount: Number(req.body.amount), months: m, method: str(req.body.method, 40), transaction_id: txn, receipt_url });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: 'This reference number was already submitted' });
      throw e;
    }
    req.app.get('io')?.to('admins').emit('new_tutor_fee', { tutor: req.user.name, amount: f.amount });
    res.status(201).json(f);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/fee/all', auth, adminOnly, async (req, res) => {
  try { res.json(await TutorFee.find().populate('tutor_id', 'name email phone').sort('-createdAt')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

const grantFee = async (tutorId, m) => {
  const cur = await tutorFeeExpiry(tutorId);
  const now = new Date();
  return addMonths(cur && cur > now ? cur : now, m);
};

router.put('/fee/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid fee' });
    const f = await TutorFee.findOneAndUpdate({ _id: req.params.id, status: 'pending' },
      { status: 'approved', reviewed_at: new Date(), admin_note: str(req.body.admin_note, 300) }, { new: true });
    if (!f) return res.status(404).json({ error: 'Fee not found or already reviewed' });
    const exp = await grantFee(f.tutor_id, f.months); // computed from OTHER approved rows
    await TutorFee.updateOne({ _id: f._id }, { expires_at: exp, expiry_notified: false });
    req.app.get('io')?.to('user_' + f.tutor_id).emit('tutor_fee_approved', { expires_at: exp });
    res.json({ ...f.toObject(), expires_at: exp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/fee/:id/reject', auth, adminOnly, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Invalid fee' });
    const f = await TutorFee.findOneAndUpdate({ _id: req.params.id, status: 'pending' },
      { status: 'rejected', reviewed_at: new Date(), admin_note: str(req.body.admin_note, 300) }, { new: true });
    if (!f) return res.status(404).json({ error: 'Fee not found or already reviewed' });
    req.app.get('io')?.to('user_' + f.tutor_id).emit('tutor_fee_rejected', { note: f.admin_note });
    res.json(f);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin can grant months directly (e.g. for your existing tutors on day one)
router.post('/fee/grant', auth, adminOnly, async (req, res) => {
  try {
    const { tutor_id } = req.body;
    if (!isId(tutor_id)) return res.status(400).json({ error: 'Invalid tutor' });
    const t = await User.findOne({ _id: tutor_id, role: 'tutor' });
    if (!t) return res.status(404).json({ error: 'Tutor not found' });
    const m = months(req.body.months);
    const exp = await grantFee(tutor_id, m);
    await TutorFee.create({ tutor_id, amount: 0, months: m, method: 'admin-grant', transaction_id: 'ADMIN-' + Date.now() + '-' + tutor_id,
      status: 'approved', reviewed_at: new Date(), expires_at: exp, admin_note: 'Granted by admin' });
    req.app.get('io')?.to('user_' + tutor_id).emit('tutor_fee_approved', { expires_at: exp });
    res.json({ tutor: t.name, expires_at: exp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
