const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const s = new mongoose.Schema({
  name:{type:String,required:true},
  email:{type:String,required:true,unique:true,lowercase:true},
  password:{type:String,required:true},
  role:{type:String,enum:['student','tutor','admin'],default:'student'},
  avatar:{type:String,default:''},
  phone:{type:String,default:''},
  grade:{type:String,default:''},
  province:{type:String,default:''},
  approved:{type:Boolean,default:true},
  bio:{type:String,default:''},
  avatarUrl:{type:String,default:''},
},{timestamps:true});
s.pre('save',async function(next){
  if(!this.isModified('password'))return next();
  this.password=await bcrypt.hash(this.password,10);next();
});
s.methods.comparePassword=function(p){return bcrypt.compare(p,this.password);};
s.methods.toPublic=function(){const o=this.toObject();delete o.password;return o;};
module.exports=mongoose.model('User',s);
