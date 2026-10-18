const mongoose = require('mongoose');
const M = mongoose.Schema.Types.Mixed;
const S = new mongoose.Schema({
  class_id: { type: mongoose.Schema.Types.ObjectId, unique: true, index: true },
  status: { type: String, default: 'draft' },
  topic: String, subject: String,
  chunks: [{ text: String, board: M }],
  index: { type: Number, default: 0 },
  run: { playing: { type: Boolean, default: false }, done: { type: Boolean, default: false }, section_end: Date },
  started_at: Date, ended_at: Date, board_state: M,
  images: [{ url: String, caption: String, at: Date }],
  attendance: [{ user_id: String, name: String, joined_at: Date, last_seen: Date }],
  questions: [{ user_id: String, name: String, text: String, answer: String, at_index: Number, at: { type: Date, default: Date.now } }],
  hands: [{ user_id: String, name: String, at: Date }],
  quizzes: [{ questions: M, at: Date, results: [{ user_id: String, name: String, score: Number, total: Number, answers: M, at: Date }] }]
}, { timestamps: true });
module.exports = mongoose.models.ClassSession || mongoose.model('ClassSession', S);
