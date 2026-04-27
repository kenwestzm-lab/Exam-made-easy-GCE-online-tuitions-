const express=require('express'),router=express.Router(),{Material}=require('../models'),{auth,tutorOrAdmin}=require('../middleware/auth'),{upload,uploadToCloudinary}=require('../config/cloudinary');
router.get('/',auth,async(req,res)=>{try{res.json(await Material.find({}).sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message})}});
router.post('/',auth,tutorOrAdmin,upload.single('file'),async(req,res)=>{
  try{
    const{title,description,subject_id,type,premium}=req.body;
    let file_url='',size='';
    if(req.file){const rType=['video','audio'].includes(type)?'video':'raw';const r=await uploadToCloudinary(req.file.buffer,'peace-mindset/materials',rType);file_url=r.secure_url;size=req.file.size>1048576?`${(req.file.size/1048576).toFixed(1)}MB`:`${Math.round(req.file.size/1024)}KB`;}
    res.status(201).json(await Material.create({title,description,subject_id:Number(subject_id),type,file_url,size,premium:premium==='true'||premium===true,tutor_id:req.user._id}));
  }catch(e){res.status(500).json({error:e.message})}
});
router.put('/:id/download',auth,async(req,res)=>{try{await Material.findByIdAndUpdate(req.params.id,{$inc:{downloads:1}});res.json({ok:true});}catch(e){res.status(500).json({error:e.message})}});
router.delete('/:id',auth,tutorOrAdmin,async(req,res)=>{try{await Material.findByIdAndDelete(req.params.id);res.json({message:'Deleted'});}catch(e){res.status(500).json({error:e.message})}});
module.exports=router;
