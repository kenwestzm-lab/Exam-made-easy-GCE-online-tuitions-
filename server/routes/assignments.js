const express=require('express'),router=express.Router(),{Assignment,Submission}=require('../models'),{auth,tutorOrAdmin}=require('../middleware/auth'),{upload,uploadToCloudinary}=require('../config/cloudinary');
router.get('/',auth,async(req,res)=>{try{res.json(await Assignment.find({}).sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message})}});
router.post('/',auth,tutorOrAdmin,upload.single('file'),async(req,res)=>{
  try{
    const{title,description,subject_id,due_date,max_marks}=req.body;let file_url='';
    if(req.file){const r=await uploadToCloudinary(req.file.buffer,'peace-mindset/assignments','raw');file_url=r.secure_url;}
    res.status(201).json(await Assignment.create({title,description,subject_id:Number(subject_id),due_date,max_marks:Number(max_marks)||100,file_url,tutor_id:req.user._id}));
  }catch(e){res.status(500).json({error:e.message})}
});
router.delete('/:id',auth,tutorOrAdmin,async(req,res)=>{try{await Assignment.findByIdAndDelete(req.params.id);res.json({message:'Deleted'});}catch(e){res.status(500).json({error:e.message})}});
router.post('/:id/submit',auth,upload.single('file'),async(req,res)=>{
  try{
    const{content}=req.body;let file_url='';
    if(req.file){const r=await uploadToCloudinary(req.file.buffer,'peace-mindset/submissions','raw');file_url=r.secure_url;}
    const ex=await Submission.findOne({assignment_id:req.params.id,student_id:req.user._id});
    if(ex)return res.status(400).json({error:'Already submitted'});
    res.status(201).json(await Submission.create({assignment_id:req.params.id,student_id:req.user._id,content,file_url}));
  }catch(e){res.status(500).json({error:e.message})}
});
router.get('/my-submissions',auth,async(req,res)=>{try{res.json(await Submission.find({student_id:req.user._id}));}catch(e){res.status(500).json({error:e.message})}});
router.get('/submissions',auth,tutorOrAdmin,async(req,res)=>{try{res.json(await Submission.find({}).populate('student_id','name email').populate('assignment_id','title subject_id').sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message})}});
router.put('/submissions/:id/grade',auth,tutorOrAdmin,async(req,res)=>{try{const{grade,marks,feedback}=req.body;res.json(await Submission.findByIdAndUpdate(req.params.id,{grade,marks,feedback,status:'graded'},{new:true}));}catch(e){res.status(500).json({error:e.message})}});
module.exports=router;
