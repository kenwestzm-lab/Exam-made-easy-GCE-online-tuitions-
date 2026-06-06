const jwt = require('jsonwebtoken');
const { User } = require('../models');
const auth = async (req, res, next) => {
  try {
    // Accept token from header OR query string (for file downloads)
    const h = req.headers.authorization;
    const queryToken = req.query.token;
    if (!h && !queryToken) return res.status(401).json({ error: 'Please login to continue' });
    const token = queryToken || h.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'peacemindset_secret');
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found. Please login again.' });
    req.user = user; next();
  } catch(e) {
    return res.status(401).json({ error: 'Invalid session. Please login again.' });
  }
};
const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};
const tutorOrAdmin = (req, res, next) => {
  if (!['tutor','admin'].includes(req.user.role)) return res.status(403).json({ error: 'Tutor or Admin access required' });
  if (req.user.role === 'tutor' && !req.user.approved) return res.status(403).json({ error: 'Account pending approval. WhatsApp 0772799672' });
  next();
};
module.exports = { auth, adminOnly, tutorOrAdmin };
