const mongoose = require('mongoose');
const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('❌ MONGODB_URI not set!'); throw new Error('MONGODB_URI missing'); }
  try {
    await mongoose.connect(uri);
    console.log('✅ MongoDB connected:', mongoose.connection.host);
  } catch(e) { console.error('❌ MongoDB failed:', e.message); throw e; }
};
module.exports = connectDB;
