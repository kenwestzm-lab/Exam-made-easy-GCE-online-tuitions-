const { tutorFeeExpiry } = require('../services/access');
// Blocks only unpaid tutors. Admins and students pass through.
const requireTutorFee = async (req, res, next) => {
  try {
    if (req.user.role !== 'tutor') return next();
    if (await tutorFeeExpiry(req.user._id)) return next();
    return res.status(402).json({
      error: 'Your K20 monthly membership fee is unpaid or expired. Pay it to schedule classes and access materials.',
      code: 'TUTOR_FEE_REQUIRED'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
module.exports = { requireTutorFee };
