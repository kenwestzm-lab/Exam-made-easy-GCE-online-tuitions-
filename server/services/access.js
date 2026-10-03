const { TutorAccess, TutorFee } = require('../models/tutorpay');

const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };

// Compares against the server clock on every call, so expiry is exact, not cron-dependent
const studentHasAccess = async (studentId, tutorId) =>
  !!tutorId && !!(await TutorAccess.exists({ student_id: studentId, tutor_id: tutorId, expires_at: { $gt: new Date() } }));

const activeTutorIds = async (studentId) =>
  (await TutorAccess.find({ student_id: studentId, expires_at: { $gt: new Date() } }).select('tutor_id'))
    .map(a => String(a.tutor_id));

// Returns the tutor's fee expiry Date if paid up, otherwise null
const tutorFeeExpiry = async (tutorId) => {
  const f = await TutorFee.findOne({ tutor_id: tutorId, status: 'approved', expires_at: { $gt: new Date() } }).sort('-expires_at');
  return f ? f.expires_at : null;
};

module.exports = { addMonths, studentHasAccess, activeTutorIds, tutorFeeExpiry };
