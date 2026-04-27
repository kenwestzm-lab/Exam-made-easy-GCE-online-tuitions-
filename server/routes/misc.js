const express=require('express'),router=express.Router();
const {Message,GroupMessage,Announcement}=require('../models');
const LiveClass=require('../models/LiveClass');
const {auth,tutorOrAdmin,adminOnly}=require('../middleware/auth');
const {upload,uploadToCloudinary}=require('../config/cloudinary');

// Direct messages
router.get('/messages/direct/:userId',auth,async(req,res)=>{try{res.json(await Message.find({$or:[{sender_id:req.user._id,receiver_id:req.params.userId},{sender_id:req.params.userId,receiver_id:req.user._id}]}).sort({createdAt:1}).limit(200));}catch(e){res.status(500).json({error:e.message})}});
router.post('/messages/direct',auth,upload.single('image'),async(req,res)=>{
  try{
    const{receiver_id,content}=req.body;let image_url='';
    if(req.file){const r=await uploadToCloudinary(req.file.buffer,'peace-mindset/chat','image');image_url=r.secure_url;}
    const msg=await Message.create({sender_id:req.user._id,receiver_id,content:content||'',image_url});
    req.app.get('io').to(`user_${receiver_id}`).emit('new_direct_message',msg);
    res.status(201).json(msg);
  }catch(e){res.status(500).json({error:e.message})}
});

// Group messages
router.get('/messages/group/:subjectId',auth,async(req,res)=>{try{res.json(await GroupMessage.find({subject_id:Number(req.params.subjectId)}).sort({createdAt:1}).limit(200));}catch(e){res.status(500).json({error:e.message})}});
router.post('/messages/group',auth,upload.single('image'),async(req,res)=>{
  try{
    const{subject_id,content}=req.body;let image_url='';
    if(req.file){const r=await uploadToCloudinary(req.file.buffer,'peace-mindset/chat','image');image_url=r.secure_url;}
    const msg=await GroupMessage.create({subject_id:Number(subject_id),sender_id:req.user._id,content:content||'',image_url});
    req.app.get('io').to(`group_${subject_id}`).emit('new_group_message',msg);
    res.status(201).json(msg);
  }catch(e){res.status(500).json({error:e.message})}
});

// Live classes
router.get('/live-classes',auth,async(req,res)=>{try{res.json(await LiveClass.find({}).sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message})}});
router.post('/live-classes',auth,tutorOrAdmin,async(req,res)=>{
  try{
    const{title,subject_id,meet_link,scheduled_date,scheduled_time,description,presenter_type,ai_character,lesson_script,lesson_topic,class_type,auto_start}=req.body;
    res.status(201).json(await LiveClass.create({title,subject_id:Number(subject_id),meet_link,scheduled_date,scheduled_time,description,tutor_id:req.user._id,presenter_type:presenter_type||'human',ai_character:ai_character||'ken',lesson_script:lesson_script||'',lesson_topic:lesson_topic||'',class_type:class_type||'whiteboard',auto_start:!!auto_start}));
  }catch(e){res.status(500).json({error:e.message})}
});
router.put('/live-classes/:id',auth,tutorOrAdmin,async(req,res)=>{
  try{
    const cls=await LiveClass.findByIdAndUpdate(req.params.id,req.body,{new:true});
    if(req.body.status){req.app.get('io').to(`class_${req.params.id}`).emit('class_status_change',{status:req.body.status,classId:req.params.id});}
    res.json(cls);
  }catch(e){res.status(500).json({error:e.message})}
});
router.delete('/live-classes/:id',auth,tutorOrAdmin,async(req,res)=>{try{await LiveClass.findByIdAndDelete(req.params.id);res.json({message:'Deleted'});}catch(e){res.status(500).json({error:e.message})}});
router.post('/live-classes/:id/whiteboard',auth,async(req,res)=>{try{await LiveClass.findByIdAndUpdate(req.params.id,{whiteboard_strokes:req.body.strokes});req.app.get('io').to(`class_${req.params.id}`).emit('whiteboard_full_sync',{strokes:req.body.strokes});res.json({ok:true});}catch(e){res.status(500).json({error:e.message})}});
router.get('/live-classes/:id/whiteboard',auth,async(req,res)=>{try{const cls=await LiveClass.findById(req.params.id);res.json({strokes:cls?.whiteboard_strokes||[]});}catch(e){res.status(500).json({error:e.message})}});

// Announcements
router.get('/announcements',auth,async(req,res)=>{try{res.json(await Announcement.find({}).sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message})}});
router.post('/announcements',auth,adminOnly,async(req,res)=>{try{const{title,content,important}=req.body;const ann=await Announcement.create({title,content,important,admin_id:req.user._id});req.app.get('io').emit('new_announcement',ann);res.status(201).json(ann);}catch(e){res.status(500).json({error:e.message})}});
router.delete('/announcements/:id',auth,adminOnly,async(req,res)=>{try{await Announcement.findByIdAndDelete(req.params.id);res.json({message:'Deleted'});}catch(e){res.status(500).json({error:e.message})}});

module.exports=router;
