const express=require('express');
const router=express.Router();
const{Assignment,Submission}=require('../models');
const{auth,tutorOrAdmin}=require('../middleware/auth');
const{upload,uploadToCloudinary}=require('../config/cloudinary');

router.get('/',auth,async(req,res)=>{
  try{res.json(await Assignment.find({}).sort({createdAt:-1}));}
  catch(e){res.status(500).json({error:e.message});}
});

router.post('/',auth,tutorOrAdmin,upload.single('file'),async(req,res)=>{
  try{
    const{title,description,subject_id,due_date,max_marks}=req.body;
    let file_url='';
    if(req.file){const r=await uploadToCloudinary(req.file.buffer,'peace-mindset/assignments');file_url=r.secure_url;}
    const a=await Assignment.create({title,description,subject_id:Number(subject_id),due_date,max_marks:Number(max_marks)||100,tutor_id:req.user._id,file_url});
    res.status(201).json(a);
  }catch(e){res.status(500).json({error:e.message});}
});

router.delete('/:id',auth,tutorOrAdmin,async(req,res)=>{
  try{await Assignment.findByIdAndDelete(req.params.id);res.json({message:'Deleted'});}
  catch(e){res.status(500).json({error:e.message});}
});

router.get('/submissions',auth,tutorOrAdmin,async(req,res)=>{
  try{const s=await Submission.find({}).populate('student_id','name email').populate('assignment_id','title subject_id max_marks').sort({createdAt:-1});res.json(s);}
  catch(e){res.status(500).json({error:e.message});}
});

router.get('/my-submissions',auth,async(req,res)=>{
  try{res.json(await Submission.find({student_id:req.user._id}));}
  catch(e){res.status(500).json({error:e.message});}
});

router.post('/:id/submit',auth,upload.single('file'),async(req,res)=>{
  try{
    const{content}=req.body;
    let file_url='';
    if(req.file){const r=await uploadToCloudinary(req.file.buffer,'peace-mindset/submissions');file_url=r.secure_url;}
    const s=await Submission.findOneAndUpdate(
      {assignment_id:req.params.id,student_id:req.user._id},
      {content,file_url,status:'submitted'},
      {upsert:true,new:true}
    );
    res.json(s);
  }catch(e){res.status(500).json({error:e.message});}
});

router.put('/submissions/:id/grade',auth,tutorOrAdmin,async(req,res)=>{
  try{
    const{grade,feedback,marks}=req.body;
    const s=await Submission.findByIdAndUpdate(req.params.id,{grade,feedback,marks:Number(marks),status:'graded'},{new:true});
    res.json(s);
  }catch(e){res.status(500).json({error:e.message});}
});

module.exports=router;
