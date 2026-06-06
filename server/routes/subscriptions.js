const express = require('express');
const router = express.Router();
const { Subscription, Payment } = require('../models');
const { auth, adminOnly } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../config/cloudinary');

// Auto-expire subscriptions in real time
const checkExpiry = async (studentId) => {
  const now = new Date();
  await Subscription.updateMany(
    { student_id: studentId, status: 'active', expires_at: { $lt: now } },
    { status: 'expired', payment_status: 'expired' }
  );
};

// GET my subscriptions - checks expiry in real time
router.get('/mine', auth, async (req, res) => {
  try {
    await checkExpiry(req.user._id);
    const subs = await Subscription.find({ student_id: req.user._id });
    res.json(subs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST submit payment proof
router.post('/payment', auth, upload.single('receipt'), async (req, res) => {
  try {
    const { subject_ids, subject_id, amount, months, method, transaction_id, notes } = req.body;
    
    // Support multiple subjects at once
    const ids = subject_ids ? JSON.parse(subject_ids) : [subject_id];
    let receipt_url = '';
    if (req.file) {
      const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/receipts', 'image');
      receipt_url = r.secure_url;
    }

    const payments = await Promise.all(ids.map(sid =>
      Payment.create({
        student_id: req.user._id,
        subject_id: Number(sid),
        amount: Number(amount),
        months: Number(months) || 1,
        method,
        transaction_id,
        notes,
        receipt_url
      })
    ));

    res.status(201).json(payments.length === 1 ? payments[0] : payments);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET my payments
router.get('/payments/mine', auth, async (req, res) => {
  try {
    res.json(await Payment.find({ student_id: req.user._id }).sort('-createdAt'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET all payments (admin)
router.get('/payments/all', auth, adminOnly, async (req, res) => {
  try {
    res.json(await Payment.find().populate('student_id', 'name email phone grade').sort('-createdAt'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT approve payment - activates subscription immediately
router.put('/payments/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    const { admin_note } = req.body;
    const p = await Payment.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', admin_note },
      { new: true }
    );
    if (!p) return res.status(404).json({ error: 'Payment not found' });

    // Calculate expiry - months from now
    const now = new Date();
    const exp = new Date(now);
    exp.setMonth(exp.getMonth() + (p.months || 1));

    // Activate or extend subscription
    const existing = await Subscription.findOne({
      student_id: p.student_id,
      subject_id: p.subject_id,
      status: 'active'
    });

    let startDate = now;
    if (existing && existing.expires_at > now) {
      // Extend from current expiry
      startDate = existing.expires_at;
    }
    const newExp = new Date(startDate);
    newExp.setMonth(newExp.getMonth() + (p.months || 1));

    await Subscription.findOneAndUpdate(
      { student_id: p.student_id, subject_id: p.subject_id },
      {
        student_id: p.student_id,
        subject_id: p.subject_id,
        status: 'active',
        payment_status: 'approved',
        expires_at: newExp,
        activated_at: now
      },
      { upsert: true, new: true }
    );

    // Notify student via socket if available
    const io = p.app?.get?.('io');

    res.json({ ...p.toObject(), subscription_expires: newExp });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT reject payment
router.put('/payments/:id/reject', auth, adminOnly, async (req, res) => {
  try {
    const p = await Payment.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', admin_note: req.body.admin_note },
      { new: true }
    );
    res.json(p);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET subscription status for a subject (real-time check)
router.get('/check/:subjectId', auth, async (req, res) => {
  try {
    await checkExpiry(req.user._id);
    const sub = await Subscription.findOne({
      student_id: req.user._id,
      subject_id: Number(req.params.subjectId),
      status: 'active'
    });
    res.json({
      active: !!sub,
      expires_at: sub?.expires_at,
      days_left: sub ? Math.ceil((new Date(sub.expires_at) - new Date()) / (1000*60*60*24)) : 0
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
