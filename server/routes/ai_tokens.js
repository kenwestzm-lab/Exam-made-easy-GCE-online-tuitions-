const express = require('express');
const router = express.Router();
const { AIToken, AIPayment } = require('../models');
const { auth, adminOnly } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../config/cloudinary');

const FREE_LIMIT = 5;

const AI_PLANS = {
  basic:    { tokens: 15,  amount: 5  },
  standard: { tokens: 50,  amount: 15 },
  premium:  { tokens: 150, amount: 40 },
};

// GET my token status
router.get('/status', auth, async (req, res) => {
  try {
    let token = await AIToken.findOne({ student_id: req.user._id });
    if (!token) token = await AIToken.create({ student_id: req.user._id });
    res.json({
      free_used: token.free_used,
      free_limit: FREE_LIMIT,
      free_remaining: Math.max(0, FREE_LIMIT - token.free_used),
      paid_tokens: token.paid_tokens,
      total_remaining: Math.max(0, FREE_LIMIT - token.free_used) + token.paid_tokens,
      can_ask: token.free_used < FREE_LIMIT || token.paid_tokens > 0,
      plans: AI_PLANS
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST use a token (called when student asks AI)
router.post('/use', auth, async (req, res) => {
  try {
    let token = await AIToken.findOne({ student_id: req.user._id });
    if (!token) token = await AIToken.create({ student_id: req.user._id });

    // Check if can ask
    if (token.free_used < FREE_LIMIT) {
      // Use free token
      token.free_used += 1;
      token.total_used += 1;
      await token.save();
      return res.json({
        success: true,
        type: 'free',
        free_remaining: Math.max(0, FREE_LIMIT - token.free_used),
        paid_tokens: token.paid_tokens
      });
    } else if (token.paid_tokens > 0) {
      // Use paid token
      token.paid_tokens -= 1;
      token.total_used += 1;
      await token.save();
      return res.json({
        success: true,
        type: 'paid',
        free_remaining: 0,
        paid_tokens: token.paid_tokens
      });
    } else {
      return res.status(403).json({
        error: 'NO_TOKENS',
        message: 'You have used all your free questions. Please buy more tokens.',
        free_used: token.free_used,
        paid_tokens: token.paid_tokens
      });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST submit AI token payment
router.post('/payment', auth, upload.single('receipt'), async (req, res) => {
  try {
    const { plan, method, transaction_id, notes } = req.body;
    const planData = AI_PLANS[plan];
    if (!planData) return res.status(400).json({ error: 'Invalid plan' });

    let receipt_url = '';
    if (req.file) {
      const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/ai-receipts', 'image');
      receipt_url = r.secure_url;
    }

    const payment = await AIPayment.create({
      student_id: req.user._id,
      plan,
      tokens: planData.tokens,
      amount: planData.amount,
      method,
      transaction_id,
      notes,
      receipt_url
    });
    res.status(201).json(payment);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET all AI payments (admin)
router.get('/payments/all', auth, adminOnly, async (req, res) => {
  try {
    res.json(await AIPayment.find().populate('student_id', 'name email phone').sort('-createdAt'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET my AI payments
router.get('/payments/mine', auth, async (req, res) => {
  try {
    res.json(await AIPayment.find({ student_id: req.user._id }).sort('-createdAt'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT approve AI payment (admin) - adds tokens immediately
router.put('/payments/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    const p = await AIPayment.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', admin_note: req.body.admin_note },
      { new: true }
    );
    if (!p) return res.status(404).json({ error: 'Payment not found' });

    // Add tokens to student immediately
    await AIToken.findOneAndUpdate(
      { student_id: p.student_id },
      { $inc: { paid_tokens: p.tokens } },
      { upsert: true, new: true }
    );

    // Notify via socket
    const io = require('../server').get?.('io');

    res.json({ ...p.toObject(), tokens_added: p.tokens });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT reject AI payment (admin)
router.put('/payments/:id/reject', auth, adminOnly, async (req, res) => {
  try {
    const p = await AIPayment.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', admin_note: req.body.admin_note },
      { new: true }
    );
    res.json(p);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
