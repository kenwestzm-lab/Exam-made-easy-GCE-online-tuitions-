const express=require('express');
const router=express.Router();
const{Subscription,PaymentRequest}=require('../models');
const{auth,adminOnly}=require('../middleware/auth');
const{upload,uploadToCloudinary}=require('../config/cloudinary');

router.get('/mine',auth,async(req,res)=>{try{res.json(await Subscription.find({student_id:req.user._id}));}catch(e){res.status(500).json({error:e.message});}});
router.get('/all',auth,adminOnly,async(req,res)=>{try{res.json(await Subscription.find({}).populate('student_id','name email phone'));}catch(e){res.status(500).json({error:e.message});}});

router.post('/payment',auth,upload.single('receipt'),async(req,res)=>{
  try{
    const{subject_id,amount,months,method,transaction_id,notes}=req.body;
    let receipt_url='',cloudinary_id='';
    if(req.file){const r=await uploadToCloudinary(req.file.buffer,'peace-mindset/receipts','image');receipt_url=r.secure_url;cloudinary_id=r.public_id;}
    const p=await PaymentRequest.create({student_id:req.user._id,subject_id:Number(subject_id),amount:Number(amount)||85,months:Number(months)||1,method,transaction_id,notes,receipt_url,cloudinary_id});
    res.status(201).json(p);
  }catch(e){res.status(500).json({error:e.message});}
});

router.get('/payments/mine',auth,async(req,res)=>{try{res.json(await PaymentRequest.find({student_id:req.user._id}).sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message});}});
router.get('/payments/all',auth,adminOnly,async(req,res)=>{try{res.json(await PaymentRequest.find({}).populate('student_id','name email phone').sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message});}});

router.put('/payments/:id/approve',auth,adminOnly,async(req,res)=>{
  try{
    const{admin_note}=req.body;
    const p=await PaymentRequest.findByIdAndUpdate(req.params.id,{status:'approved',admin_note:admin_note||''},{new:true}).populate('student_id','name email');
    if(!p)return res.status(404).json({error:'Not found'});
    const exp=new Date();exp.setMonth(exp.getMonth()+(p.months||1));
    await Subscription.findOneAndUpdate(
      {student_id:p.student_id._id,subject_id:p.subject_id},
      {payment_status:'approved',status:'active',amount:p.amount,months:p.months,expires_at:exp},
      {upsert:true,new:true}
    );
    res.json(p);
  }catch(e){res.status(500).json({error:e.message});}
});

router.put('/payments/:id/reject',auth,adminOnly,async(req,res)=>{
  try{const p=await PaymentRequest.findByIdAndUpdate(req.params.id,{status:'rejected',admin_note:req.body.admin_note||''},{new:true});res.json(p);}
  catch(e){res.status(500).json({error:e.message});}
});

module.exports=router;
