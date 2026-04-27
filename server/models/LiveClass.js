const mongoose = require('mongoose');
const liveClassSchema = new mongoose.Schema({
  title:{type:String,required:true},
  subject_id:{type:Number,required:true},
  tutor_id:{type:mongoose.Schema.Types.ObjectId,ref:'User'},
  meet_link:{type:String,default:''},
  scheduled_date:{type:String,default:''},
  scheduled_time:{type:String,default:''},
  status:{type:String,enum:['upcoming','live','ended'],default:'upcoming'},
  description:{type:String,default:''},
  recording_url:{type:String,default:''},
  presenter_type:{type:String,enum:['human','ai'],default:'human'},
  ai_character:{type:String,enum:['ken','msimbi'],default:'ken'},
  lesson_script:{type:String,default:''},
  lesson_topic:{type:String,default:''},
  auto_start:{type:Boolean,default:false},
  class_type:{type:String,enum:['video','whiteboard','audio'],default:'whiteboard'},
  whiteboard_strokes:{type:mongoose.Schema.Types.Mixed,default:[]},
},{timestamps:true});
module.exports = mongoose.models.LiveClass || mongoose.model('LiveClass',liveClassSchema);
