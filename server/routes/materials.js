const express=require('express');
const router=express.Router();
const{Material}=require('../models');
const{auth,tutorOrAdmin}=require('../middleware/auth');
const{upload,uploadToCloudinary,cloudinary}=require('../config/cloudinary');

router.get('/',auth,async(req,res)=>{
  try{
    const q={};
    if(req.query.subject)q.subject_id=Number(req.query.subject);
    const m=await Material.find(q).sort({createdAt:-1});
    res.json(m);
  }catch(e){res.status(500).json({error:e.message});}
});

router.post('/',auth,tutorOrAdmin,upload.single('file'),async(req,res)=>{
  try{
    const{title,description,subject_id,type,premium}=req.body;
    let file_url='',cloudinary_id='',size='';
    if(req.file){
      const rt=['video/mp4','video/webm'].includes(req.file.mimetype)?'video':'auto';
      const r=await uploadToCloudinary(req.file.buffer,'peace-mindset/materials',rt);
      file_url=r.secure_url;cloudinary_id=r.public_id;
      size=Math.round(req.file.size/1024)+'KB';
    }
    const m=await Material.create({title,description,subject_id:Number(subject_id),type,file_url,cloudinary_id,size,premium:premium==='true'||premium===true,tutor_id:req.user._id});
    res.status(201).json(m);
  }catch(e){res.status(500).json({error:e.message});}
});

router.delete('/:id',auth,tutorOrAdmin,async(req,res)=>{
  try{
    const m=await Material.findById(req.params.id);
    if(!m)return res.status(404).json({error:'Not found'});
    if(m.cloudinary_id)await cloudinary.uploader.destroy(m.cloudinary_id,{resource_type:'auto'}).catch(()=>{});
    await m.deleteOne();
    res.json({message:'Deleted'});
  }catch(e){res.status(500).json({error:e.message});}
});

router.put('/:id/download',auth,async(req,res)=>{
  try{await Material.findByIdAndUpdate(req.params.id,{$inc:{downloads:1}});res.json({ok:true});}
  catch(e){res.status(500).json({error:e.message});}
});

module.exports=router;
