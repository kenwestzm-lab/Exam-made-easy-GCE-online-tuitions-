const mongoose = require('mongoose');
module.exports = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set in Render environment');
  await mongoose.connect(uri);
  console.log('✅ MongoDB connected:', mongoose.connection.host);
};
