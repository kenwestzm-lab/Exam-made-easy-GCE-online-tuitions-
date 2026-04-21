const express=require('express');
const router=express.Router();
const User=require('../models/User');
const{auth,adminOnly}=require('../middleware/auth');

router.get('/',auth,async(req,res)=>{
  try{const u=await User.find({}).select('-password').sort({name:1});res.json(u);}
  catch(e){res.status(500).json({error:e.message});}
});
router.get('/pending-tutors',auth,adminOnly,async(req,res)=>{
  try{const u=await User.find({role:'tutor',approved:false}).select('-password');res.json(u);}
  catch(e){res.status(500).json({error:e.message});}
});
router.put('/:id/approve',auth,adminOnly,async(req,res)=>{
  try{const u=await User.findByIdAndUpdate(req.params.id,{approved:true},{new:true}).select('-password');res.json(u);}
  catch(e){res.status(500).json({error:e.message});}
});
router.delete('/:id',auth,adminOnly,async(req,res)=>{
  try{await User.findByIdAndDelete(req.params.id);res.json({message:'Deleted'});}
  catch(e){res.status(500).json({error:e.message});}
});
router.put('/:id/role',auth,adminOnly,async(req,res)=>{
  try{const u=await User.findByIdAndUpdate(req.params.id,{role:req.body.role},{new:true}).select('-password');res.json(u);}
  catch(e){res.status(500).json({error:e.message});}
});
module.exports=router;
