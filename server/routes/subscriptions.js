const express=require('express'),router=express.Router(),{Subscription,PaymentRequest}=require('../models'),{auth,adminOnly}=require('../middleware/auth'),{upload,uploadToCloudinary}=require('../config/cloudinary');
router.get('/mine',auth,async(req,res)=>{try{res.json(await Subscription.find({student_id:req.user._id}));}catch(e){res.status(500).json({error:e.message})}});
router.get('/payments/mine',auth,async(req,res)=>{try{res.json(await PaymentRequest.find({student_id:req.user._id}).sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message})}});
router.get('/payments/all',auth,adminOnly,async(req,res)=>{try{res.json(await PaymentRequest.find({}).populate('student_id','name email phone').sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message})}});
router.post('/payment',auth,upload.single('receipt'),async(req,res)=>{
  try{
    const{subject_id,amount,months,method,transaction_id,notes}=req.body;let receipt_url='';
    if(req.file){const r=await uploadToCloudinary(req.file.buffer,'peace-mindset/receipts','image');receipt_url=r.secure_url;}
    res.status(201).json(await PaymentRequest.create({student_id:req.user._id,subject_id:Number(subject_id),amount:Number(amount),months:Number(months)||1,method,transaction_id,notes,receipt_url,status:'pending'}));
  }catch(e){res.status(500).json({error:e.message})}
});
router.put('/payments/:id/approve',auth,adminOnly,async(req,res)=>{
  try{
    const{admin_note}=req.body;const pay=await PaymentRequest.findByIdAndUpdate(req.params.id,{status:'approved',admin_note},{new:true});
    const end=new Date();end.setMonth(end.getMonth()+(pay.months||1));
    await Subscription.findOneAndUpdate({student_id:pay.student_id,subject_id:pay.subject_id},{student_id:pay.student_id,subject_id:pay.subject_id,payment_status:'approved',status:'active',end_date:end},{upsert:true,new:true});
    res.json(pay);
  }catch(e){res.status(500).json({error:e.message})}
});
router.put('/payments/:id/reject',auth,adminOnly,async(req,res)=>{try{res.json(await PaymentRequest.findByIdAndUpdate(req.params.id,{status:'rejected',admin_note:req.body.admin_note||'Could not verify payment'},{new:true}));}catch(e){res.status(500).json({error:e.message})}});
module.exports=router;
