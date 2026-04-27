const mongoose = require('mongoose');
const S = mongoose.Schema;

const User = mongoose.models.User || mongoose.model('User', new S({
  name:{type:String,required:true,trim:true},
  email:{type:String,required:true,unique:true,lowercase:true,trim:true},
  password:{type:String,required:true,select:false},
  role:{type:String,enum:['student','tutor','admin'],default:'student'},
  avatar:{type:String,default:''},
  avatarUrl:{type:String,default:''},
  phone:{type:String,default:''},
  grade:{type:String,default:''},
  province:{type:String,default:'Lusaka'},
  bio:{type:String,default:''},
  approved:{type:Boolean,default:true},
},{timestamps:true}));

const Material = mongoose.models.Material || mongoose.model('Material', new S({
  title:String, description:{type:String,default:''},
  subject_id:Number, tutor_id:{type:S.Types.ObjectId,ref:'User'},
  type:{type:String,enum:['pdf','pptx','video','audio','word','image','link'],default:'pdf'},
  file_url:{type:String,default:''}, size:{type:String,default:''},
  premium:{type:Boolean,default:true}, downloads:{type:Number,default:0},
},{timestamps:true}));

const Assignment = mongoose.models.Assignment || mongoose.model('Assignment', new S({
  title:String, description:{type:String,default:''},
  subject_id:Number, tutor_id:{type:S.Types.ObjectId,ref:'User'},
  due_date:{type:String,default:''}, max_marks:{type:Number,default:100},
  file_url:{type:String,default:''},
},{timestamps:true}));

const Submission = mongoose.models.Submission || mongoose.model('Submission', new S({
  assignment_id:{type:S.Types.ObjectId,ref:'Assignment'},
  student_id:{type:S.Types.ObjectId,ref:'User'},
  content:{type:String,default:''}, file_url:{type:String,default:''},
  status:{type:String,enum:['submitted','graded'],default:'submitted'},
  grade:{type:String,default:''}, marks:Number, feedback:{type:String,default:''},
},{timestamps:true}));

const Test = mongoose.models.Test || mongoose.model('Test', new S({
  title:String, subject_id:Number,
  tutor_id:{type:S.Types.ObjectId,ref:'User'},
  duration:{type:Number,default:30}, is_active:{type:Boolean,default:true},
},{timestamps:true}));

const Question = mongoose.models.Question || mongoose.model('Question', new S({
  test_id:{type:S.Types.ObjectId,ref:'Test'},
  type:{type:String,enum:['mcq','truefalse','short'],default:'mcq'},
  question:String, options:[String], answer:String,
  explanation:{type:String,default:''}, order_num:{type:Number,default:0},
},{timestamps:true}));

const TestResult = mongoose.models.TestResult || mongoose.model('TestResult', new S({
  test_id:{type:S.Types.ObjectId,ref:'Test'},
  student_id:{type:S.Types.ObjectId,ref:'User'},
  answers:{type:S.Types.Mixed,default:{}},
  score:{type:Number,default:0}, total:{type:Number,default:0},
  percent:{type:Number,default:0}, taken_at:{type:Date,default:Date.now},
},{timestamps:true}));

const ResultComment = mongoose.models.ResultComment || mongoose.model('ResultComment', new S({
  result_id:{type:S.Types.ObjectId,ref:'TestResult'},
  tutor_id:{type:S.Types.ObjectId,ref:'User'},
  comment:String, question_index:{type:Number,default:-1},
},{timestamps:true}));

const Message = mongoose.models.Message || mongoose.model('Message', new S({
  sender_id:{type:S.Types.ObjectId,ref:'User'},
  receiver_id:{type:S.Types.ObjectId,ref:'User'},
  content:{type:String,default:''}, image_url:{type:String,default:''},
  read:{type:Boolean,default:false},
},{timestamps:true}));

const GroupMessage = mongoose.models.GroupMessage || mongoose.model('GroupMessage', new S({
  subject_id:Number, sender_id:{type:S.Types.ObjectId,ref:'User'},
  content:{type:String,default:''}, image_url:{type:String,default:''},
},{timestamps:true}));

const Subscription = mongoose.models.Subscription || mongoose.model('Subscription', new S({
  student_id:{type:S.Types.ObjectId,ref:'User'}, subject_id:Number,
  payment_status:{type:String,enum:['pending','approved','rejected'],default:'pending'},
  status:{type:String,enum:['active','expired','cancelled'],default:'active'},
  end_date:Date,
},{timestamps:true}));

const PaymentRequest = mongoose.models.PaymentRequest || mongoose.model('PaymentRequest', new S({
  student_id:{type:S.Types.ObjectId,ref:'User'}, subject_id:Number,
  amount:Number, months:{type:Number,default:1},
  method:{type:String,enum:['mtn','airtel','bank','cash'],default:'mtn'},
  transaction_id:{type:String,default:''}, receipt_url:{type:String,default:''},
  notes:{type:String,default:''}, status:{type:String,enum:['pending','approved','rejected'],default:'pending'},
  admin_note:{type:String,default:''},
},{timestamps:true}));

const Announcement = mongoose.models.Announcement || mongoose.model('Announcement', new S({
  title:String, content:String,
  important:{type:Boolean,default:false},
  admin_id:{type:S.Types.ObjectId,ref:'User'},
},{timestamps:true}));

module.exports = { User,Material,Assignment,Submission,Test,Question,TestResult,ResultComment,Message,GroupMessage,Subscription,PaymentRequest,Announcement };
