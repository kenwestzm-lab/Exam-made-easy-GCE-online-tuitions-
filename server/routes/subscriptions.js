const express = require('express');
const router = express.Router();
const { Subscription, Payment } = require('../models');
const { auth, adminOnly } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../config/cloudinary');

router.get('/mine', auth, async (req, res) => {
  try { res.json(await Subscription.find({ student_id: req.user._id })); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/payment', auth, upload.single('receipt'), async (req, res) => {
  try {
    const { subject_id, amount, months, method, transaction_id, notes } = req.body;
    let receipt_url = '';
    if (req.file) {
      const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/receipts', 'image');
      receipt_url = r.secure_url;
    }
    const p = await Payment.create({ student_id: req.user._id, subject_id: Number(subject_id), amount: Number(amount), months: Number(months), method, transaction_id, notes, receipt_url });
    res.status(201).json(p);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/payments/mine', auth, async (req, res) => {
  try { res.json(await Payment.find({ student_id: req.user._id }).sort('-createdAt')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/payments/all', auth, adminOnly, async (req, res) => {
  try { res.json(await Payment.find().populate('student_id', 'name email phone').sort('-createdAt')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/payments/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    const { admin_note } = req.body;
    const p = await Payment.findByIdAndUpdate(req.params.id, { status: 'approved', admin_note }, { new: true });
    const exp = new Date(); exp.setMonth(exp.getMonth() + (p.months || 1));
    await Subscription.findOneAndUpdate(
      { student_id: p.student_id, subject_id: p.subject_id },
      { student_id: p.student_id, subject_id: p.subject_id, status: 'active', payment_status: 'approved', expires_at: exp },
      { upsert: true, new: true }
    );
    res.json(p);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/payments/:id/reject', auth, adminOnly, async (req, res) => {
  try {
    const p = await Payment.findByIdAndUpdate(req.params.id, { status: 'rejected', admin_note: req.body.admin_note }, { new: true });
    res.json(p);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
