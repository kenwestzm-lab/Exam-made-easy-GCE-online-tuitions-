const express=require('express');
const router=express.Router();
const{Message,GroupMessage,LiveClass,Announcement}=require('../models');
const{auth,tutorOrAdmin,adminOnly}=require('../middleware/auth');
const{upload,uploadToCloudinary}=require('../config/cloudinary');

router.get('/messages/direct/:userId',auth,async(req,res)=>{
  try{const m=await Message.find({$or:[{sender_id:req.user._id,receiver_id:req.params.userId},{sender_id:req.params.userId,receiver_id:req.user._id}]}).sort({createdAt:1}).limit(200);res.json(m);}
  catch(e){res.status(500).json({error:e.message});}
});

router.post('/messages/direct',auth,upload.single('image'),async(req,res)=>{
  try{
    const{receiver_id,content}=req.body;
    let image_url='';
    if(req.file){const r=await uploadToCloudinary(req.file.buffer,'peace-mindset/chat','image');image_url=r.secure_url;}
    const m=await Message.create({sender_id:req.user._id,receiver_id,content:content||'',image_url});
    req.app.get('io').to('user_'+receiver_id).emit('new_direct_message',m);
    res.status(201).json(m);
  }catch(e){res.status(500).json({error:e.message});}
});

router.get('/messages/group/:subjectId',auth,async(req,res)=>{
  try{res.json(await GroupMessage.find({subject_id:Number(req.params.subjectId)}).sort({createdAt:1}).limit(200));}
  catch(e){res.status(500).json({error:e.message});}
});

router.post('/messages/group',auth,upload.single('image'),async(req,res)=>{
  try{
    const{subject_id,content}=req.body;
    let image_url='';
    if(req.file){const r=await uploadToCloudinary(req.file.buffer,'peace-mindset/chat','image');image_url=r.secure_url;}
    const m=await GroupMessage.create({subject_id:Number(subject_id),sender_id:req.user._id,content:content||'',image_url});
    req.app.get('io').to('group_'+subject_id).emit('new_group_message',m);
    res.status(201).json(m);
  }catch(e){res.status(500).json({error:e.message});}
});

router.get('/live-classes',auth,async(req,res)=>{try{res.json(await LiveClass.find({}).sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message});}});

router.post('/live-classes',auth,tutorOrAdmin,async(req,res)=>{
  try{const{title,subject_id,meet_link,scheduled_date,scheduled_time,description}=req.body;const lc=await LiveClass.create({title,subject_id:Number(subject_id),meet_link,scheduled_date,scheduled_time,description,tutor_id:req.user._id});res.status(201).json(lc);}
  catch(e){res.status(500).json({error:e.message});}
});

router.put('/live-classes/:id',auth,tutorOrAdmin,async(req,res)=>{
  try{const lc=await LiveClass.findByIdAndUpdate(req.params.id,req.body,{new:true});res.json(lc);}
  catch(e){res.status(500).json({error:e.message});}
});

router.delete('/live-classes/:id',auth,tutorOrAdmin,async(req,res)=>{
  try{await LiveClass.findByIdAndDelete(req.params.id);res.json({message:'Deleted'});}
  catch(e){res.status(500).json({error:e.message});}
});

router.get('/announcements',auth,async(req,res)=>{try{res.json(await Announcement.find({}).sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message});}});

router.post('/announcements',auth,adminOnly,async(req,res)=>{
  try{const{title,content,important}=req.body;const a=await Announcement.create({title,content,important,admin_id:req.user._id});req.app.get('io').emit('new_announcement',a);res.status(201).json(a);}
  catch(e){res.status(500).json({error:e.message});}
});

router.delete('/announcements/:id',auth,adminOnly,async(req,res)=>{
  try{await Announcement.findByIdAndDelete(req.params.id);res.json({message:'Deleted'});}
  catch(e){res.status(500).json({error:e.message});}
});

module.exports=router;
