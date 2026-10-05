const { TutorAccess, TutorFee } = require('../models/tutorpay');

const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const accessKey = (tutorId, subjectId) => String(tutorId) + ':' + Number(subjectId);

// Access is per tutor AND per subject. The server clock is compared on every call, so expiry is exact.
const studentHasAccess = async (studentId, tutorId, subjectId) =>
  !!tutorId && subjectId != null && !!(await TutorAccess.exists({
    student_id: studentId, tutor_id: tutorId, subject_id: Number(subjectId), expires_at: { $gt: new Date() }
  }));

const activeKeys = async (studentId) =>
  (await TutorAccess.find({ student_id: studentId, expires_at: { $gt: new Date() } }).select('tutor_id subject_id'))
    .map(a => accessKey(a.tutor_id, a.subject_id));

const tutorFeeExpiry = async (tutorId) => {
  const f = await TutorFee.findOne({ tutor_id: tutorId, status: 'approved', expires_at: { $gt: new Date() } }).sort('-expires_at');
  return f ? f.expires_at : null;
};

module.exports = { addMonths, accessKey, studentHasAccess, activeKeys, tutorFeeExpiry };
