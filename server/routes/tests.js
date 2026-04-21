const express=require('express');
const router=express.Router();
const{Test,Question,TestResult,ResultComment}=require('../models');
const{auth,tutorOrAdmin}=require('../middleware/auth');

router.get('/',auth,async(req,res)=>{try{res.json(await Test.find({}).sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message});}});
router.get('/questions',auth,async(req,res)=>{try{res.json(await Question.find({}).sort({order_num:1}));}catch(e){res.status(500).json({error:e.message});}});

router.post('/',auth,tutorOrAdmin,async(req,res)=>{
  try{const{title,subject_id,duration}=req.body;const t=await Test.create({title,subject_id:Number(subject_id),duration:Number(duration)||30,tutor_id:req.user._id});res.status(201).json(t);}
  catch(e){res.status(500).json({error:e.message});}
});

router.delete('/:id',auth,tutorOrAdmin,async(req,res)=>{
  try{await Test.findByIdAndDelete(req.params.id);await Question.deleteMany({test_id:req.params.id});res.json({message:'Deleted'});}
  catch(e){res.status(500).json({error:e.message});}
});

router.post('/:id/questions',auth,tutorOrAdmin,async(req,res)=>{
  try{const{type,question,options,answer,order_num}=req.body;const q=await Question.create({test_id:req.params.id,type,question,options,answer,order_num});res.status(201).json(q);}
  catch(e){res.status(500).json({error:e.message});}
});

router.delete('/questions/:id',auth,tutorOrAdmin,async(req,res)=>{
  try{await Question.findByIdAndDelete(req.params.id);res.json({message:'Deleted'});}
  catch(e){res.status(500).json({error:e.message});}
});

router.get('/results',auth,async(req,res)=>{
  try{const f=req.user.role==='student'?{student_id:req.user._id}:{};res.json(await TestResult.find(f).sort({createdAt:-1}));}
  catch(e){res.status(500).json({error:e.message});}
});

router.post('/:id/submit',auth,async(req,res)=>{
  try{
    const{answers}=req.body;
    const ex=await TestResult.findOne({test_id:req.params.id,student_id:req.user._id});
    if(ex)return res.status(400).json({error:'Already submitted'});
    const qs=await Question.find({test_id:req.params.id});
    let score=0;
    qs.forEach(q=>{
      const sa=(answers[q._id.toString()]||'').toLowerCase().trim();
      const ca=(q.answer||'').toLowerCase().trim();
      if(sa===ca)score++;
    });
    const total=qs.length;
    const percent=total>0?Math.round((score/total)*100):0;
    const r=await TestResult.create({test_id:req.params.id,student_id:req.user._id,answers,score,total,percent,taken_at:new Date()});
    res.status(201).json(r);
  }catch(e){res.status(500).json({error:e.message});}
});

router.get('/result-comments',auth,async(req,res)=>{try{res.json(await ResultComment.find({}).sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message});}});

router.post('/result-comments',auth,tutorOrAdmin,async(req,res)=>{
  try{const{result_id,comment,question_index}=req.body;const c=await ResultComment.create({result_id,tutor_id:req.user._id,comment,question_index:question_index??-1});res.status(201).json(c);}
  catch(e){res.status(500).json({error:e.message});}
});

module.exports=router;
