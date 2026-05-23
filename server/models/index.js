const mongoose = require('mongoose');
const { Schema } = mongoose;

// USER
const UserSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['student','tutor','admin'], default: 'student' },
  approved: { type: Boolean, default: false },
  phone: String, grade: String, province: String, bio: String,
  avatar: String, avatarUrl: String,
}, { timestamps: true });

// SUBSCRIPTION
const SubSchema = new Schema({
  student_id: { type: Schema.Types.ObjectId, ref: 'User' },
  subject_id: Number,
  status: { type: String, default: 'active' },
  payment_status: { type: String, default: 'pending' },
  expires_at: Date,
}, { timestamps: true });

// PAYMENT
const PaySchema = new Schema({
  student_id: { type: Schema.Types.ObjectId, ref: 'User' },
  subject_id: Number,
  amount: Number, months: Number, method: String,
  transaction_id: String, receipt_url: String,
  status: { type: String, default: 'pending' },
  admin_note: String,
}, { timestamps: true });

// MATERIAL
const MatSchema = new Schema({
  title: { type: String, required: true },
  description: String, subject_id: Number,
  type: String, file_url: String, size: String,
  premium: { type: Boolean, default: true },
  downloads: { type: Number, default: 0 },
  tutor_id: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// ASSIGNMENT
const AsnSchema = new Schema({
  title: { type: String, required: true },
  description: String, subject_id: Number,
  due_date: String, max_marks: Number,
  file_url: String,
  tutor_id: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// SUBMISSION
const SubAsnSchema = new Schema({
  assignment_id: { type: Schema.Types.ObjectId, ref: 'Assignment' },
  student_id: { type: Schema.Types.ObjectId, ref: 'User' },
  content: String, file_url: String,
  status: { type: String, default: 'submitted' },
  grade: String, marks: Number, feedback: String,
}, { timestamps: true });

// TEST
const TestSchema = new Schema({
  title: { type: String, required: true },
  subject_id: Number, duration: Number,
  tutor_id: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// QUESTION
const QSchema = new Schema({
  test_id: { type: Schema.Types.ObjectId, ref: 'Test' },
  type: { type: String, enum: ['mcq','truefalse','short'] },
  question: String, options: [String],
  answer: String, explanation: String,
}, { timestamps: true });

// TEST RESULT
const ResSchema = new Schema({
  test_id: { type: Schema.Types.ObjectId, ref: 'Test' },
  student_id: { type: Schema.Types.ObjectId, ref: 'User' },
  answers: Schema.Types.Mixed,
  score: Number, total: Number, percent: Number,
}, { timestamps: true });

// LIVE CLASS
const LiveSchema = new Schema({
  title: { type: String, required: true },
  subject_id: Number,
  scheduled_date: String, scheduled_time: String,
  description: String, meet_link: String, recording_url: String,
  status: { type: String, default: 'upcoming' },
  presenter_type: { type: String, default: 'human' },
  ai_character: { type: String, default: 'ken' },
  class_type: { type: String, default: 'whiteboard' },
  lesson_topic: String, lesson_script: String,
  auto_start: { type: Boolean, default: false },
  whiteboard_data: Schema.Types.Mixed,
  tutor_id: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// MESSAGE
const MsgSchema = new Schema({
  sender_id: { type: Schema.Types.ObjectId, ref: 'User' },
  receiver_id: { type: Schema.Types.ObjectId, ref: 'User' },
  subject_id: Number, content: String, image_url: String,
  type: { type: String, default: 'direct' },
}, { timestamps: true });

// ANNOUNCEMENT
const AnnSchema = new Schema({
  title: String, content: String,
  important: { type: Boolean, default: false },
  author_id: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = {
  User: mongoose.model('User', UserSchema),
  Subscription: mongoose.model('Subscription', SubSchema),
  Payment: mongoose.model('Payment', PaySchema),
  Material: mongoose.model('Material', MatSchema),
  Assignment: mongoose.model('Assignment', AsnSchema),
  Submission: mongoose.model('Submission', SubAsnSchema),
  Test: mongoose.model('Test', TestSchema),
  Question: mongoose.model('Question', QSchema),
  Result: mongoose.model('Result', ResSchema),
  LiveClass: mongoose.model('LiveClass', LiveSchema),
  Message: mongoose.model('Message', MsgSchema),
  Announcement: mongoose.model('Announcement', AnnSchema),
};
