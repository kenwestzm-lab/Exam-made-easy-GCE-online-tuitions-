const express=require('express'),router=express.Router(),{Test,Question,TestResult,ResultComment}=require('../models'),{auth,tutorOrAdmin}=require('../middleware/auth');
router.get('/',auth,async(req,res)=>{try{res.json(await Test.find({}).sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message})}});
router.post('/',auth,tutorOrAdmin,async(req,res)=>{try{const{title,subject_id,duration}=req.body;res.status(201).json(await Test.create({title,subject_id:Number(subject_id),duration:Number(duration)||30,tutor_id:req.user._id}));}catch(e){res.status(500).json({error:e.message})}});
router.delete('/:id',auth,tutorOrAdmin,async(req,res)=>{try{await Test.findByIdAndDelete(req.params.id);await Question.deleteMany({test_id:req.params.id});res.json({message:'Deleted'});}catch(e){res.status(500).json({error:e.message})}});
router.get('/questions',auth,async(req,res)=>{try{res.json(await Question.find({}).sort({order_num:1}));}catch(e){res.status(500).json({error:e.message})}});
router.post('/:id/questions',auth,tutorOrAdmin,async(req,res)=>{try{const{type,question,options,answer,explanation,order_num}=req.body;res.status(201).json(await Question.create({test_id:req.params.id,type,question,options:options||[],answer,explanation:explanation||'',order_num:order_num||0}));}catch(e){res.status(500).json({error:e.message})}});
router.post('/:id/submit',auth,async(req,res)=>{
  try{
    const{answers}=req.body;const qs=await Question.find({test_id:req.params.id});
    let score=0;qs.forEach(q=>{const g=(answers[q._id.toString()]||'').toString().toLowerCase().trim();const c=(q.answer||'').toString().toLowerCase().trim();if(g===c)score++;});
    const percent=qs.length>0?Math.round((score/qs.length)*100):0;
    const ex=await TestResult.findOne({test_id:req.params.id,student_id:req.user._id});
    let result;
    if(ex){result=await TestResult.findByIdAndUpdate(ex._id,{answers,score,total:qs.length,percent,taken_at:new Date()},{new:true});}
    else{result=await TestResult.create({test_id:req.params.id,student_id:req.user._id,answers,score,total:qs.length,percent});}
    res.json(result);
  }catch(e){res.status(500).json({error:e.message})}
});
router.get('/results',auth,async(req,res)=>{try{const f=req.user.role==='student'?{student_id:req.user._id}:{};res.json(await TestResult.find(f).sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message})}});
router.get('/result-comments',auth,async(req,res)=>{try{res.json(await ResultComment.find({}).sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message})}});
router.post('/result-comments',auth,tutorOrAdmin,async(req,res)=>{try{const{result_id,comment,question_index}=req.body;res.status(201).json(await ResultComment.create({result_id,comment,question_index:question_index||-1,tutor_id:req.user._id}));}catch(e){res.status(500).json({error:e.message})}});
module.exports=router;
