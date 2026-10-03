const mongoose = require('mongoose');
const { Schema } = mongoose;
const ref = { type: Schema.Types.ObjectId, ref: 'User', required: true };
const reg = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

const PayInfo = new Schema({
  tutor_id: { ...ref, unique: true },
  price_per_month: { type: Number, required: true, min: 1 },
  methods: [{ method: String, account_name: String, account_number: String, instructions: String }],
  active: { type: Boolean, default: true },
}, { timestamps: true });

const TutorPaymentS = new Schema({
  student_id: ref, tutor_id: ref,
  amount: Number, months: { type: Number, default: 1 }, method: String,
  transaction_id: { type: String, required: true },
  receipt_url: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  note: String, reviewed_at: Date, expires_at: Date,
}, { timestamps: true });
TutorPaymentS.index({ tutor_id: 1, transaction_id: 1 }, { unique: true });

const TutorAccessS = new Schema({
  student_id: ref, tutor_id: ref,
  expires_at: { type: Date, required: true },
  expiry_notified: { type: Boolean, default: false },
  last_payment_id: Schema.Types.ObjectId,
}, { timestamps: true });
TutorAccessS.index({ student_id: 1, tutor_id: 1 }, { unique: true });

const TutorFeeS = new Schema({
  tutor_id: ref,
  amount: { type: Number, default: 20 }, months: { type: Number, default: 1 },
  method: String, transaction_id: { type: String, required: true, unique: true },
  receipt_url: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  admin_note: String, reviewed_at: Date,
  expires_at: Date, expiry_notified: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = {
  PayInfo: reg('TutorPayInfo', PayInfo),
  TutorPayment: reg('TutorPayment', TutorPaymentS),
  TutorAccess: reg('TutorAccess', TutorAccessS),
  TutorFee: reg('TutorFee', TutorFeeS),
};
