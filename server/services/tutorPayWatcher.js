const { TutorAccess, TutorFee } = require('../models/tutorpay');
const { tutorFeeExpiry } = require('./access');

// Pushes live "expired" events. Security does NOT depend on this: every request checks the clock itself.
module.exports = (io) => {
  const run = async () => {
    try {
      const now = new Date();
      const acc = await TutorAccess.find({ expires_at: { $lte: now }, expiry_notified: false });
      for (const a of acc) {
        const r = await TutorAccess.updateOne({ _id: a._id, expiry_notified: false }, { expiry_notified: true });
        if (r.modifiedCount) io.to('user_' + a.student_id).emit('access_expired', { tutor_id: a.tutor_id });
      }
      const fees = await TutorFee.find({ status: 'approved', expires_at: { $lte: now }, expiry_notified: false });
      for (const f of fees) {
        await TutorFee.updateOne({ _id: f._id }, { expiry_notified: true });
        if (!(await tutorFeeExpiry(f.tutor_id))) io.to('user_' + f.tutor_id).emit('tutor_fee_expired', {});
      }
    } catch (e) { console.error('tutorPayWatcher error:', e.message); }
  };
  run();
  setInterval(run, 30 * 1000);
};
