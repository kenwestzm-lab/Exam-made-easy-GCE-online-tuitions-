require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://peacemindset:Ken2004west@cluster0.q7jxde7.mongodb.net/peace-mindset?retryWrites=true&w=majority&appName=Cluster0';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const { User } = require('./models');

  // Remove old admins
  const del = await User.deleteMany({ role: 'admin' });
  console.log(`Removed ${del.deletedCount} old admin(s)`);

  const hash = await bcrypt.hash('Ken2004west#', 12);
  const admin = await User.create({
    name: 'Peace Mindset Admin',
    email: 'kenwestzm@gmail.com',
    password: hash,
    role: 'admin',
    avatar: 'A',
    avatarUrl: '',
    phone: '0772799672',
    province: 'Lusaka',
    approved: true,
    bio: 'Peace Mindset Private School Administrator'
  });

  console.log('');
  console.log('✅ ====================================');
  console.log('   ADMIN ACCOUNT CREATED!');
  console.log('   Email:    kenwestzm@gmail.com');
  console.log('   Password: Ken2004west#');
  console.log('   Role:     ADMIN');
  console.log('✅ ====================================');
  console.log('');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
