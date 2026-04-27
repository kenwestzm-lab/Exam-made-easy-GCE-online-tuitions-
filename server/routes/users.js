const express=require('express'),router=express.Router(),{User}=require('../models'),{auth,adminOnly}=require('../middleware/auth');
router.get('/',auth,adminOnly,async(req,res)=>{try{res.json(await User.find({}).sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message})}});
router.put('/:id/approve',auth,adminOnly,async(req,res)=>{try{res.json(await User.findByIdAndUpdate(req.params.id,{approved:true},{new:true}));}catch(e){res.status(500).json({error:e.message})}});
router.delete('/:id',auth,adminOnly,async(req,res)=>{try{await User.findByIdAndDelete(req.params.id);res.json({message:'Deleted'});}catch(e){res.status(500).json({error:e.message})}});
module.exports=router;
