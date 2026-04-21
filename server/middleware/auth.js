const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = async (req,res,next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ','');
    if (!token) return res.status(401).json({error:'No token'});
    const d = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(d.id).select('-password');
    if (!user) return res.status(401).json({error:'Not found'});
    req.user = user; next();
  } catch { res.status(401).json({error:'Invalid token'}); }
};
const adminOnly = (req,res,next) => req.user?.role==='admin'?next():res.status(403).json({error:'Admin only'});
const tutorOrAdmin = (req,res,next) => ['admin','tutor'].includes(req.user?.role)?next():res.status(403).json({error:'Tutor/Admin only'});
module.exports = {auth, adminOnly, tutorOrAdmin};
