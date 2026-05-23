require('dotenv').config();
const bcrypt = require('bcryptjs');
const connectDB = require('./config/db');
const { User } = require('./models');

async function seed() {
  await connectDB();
  const exists = await User.findOne({ email: 'kenwestzm@gmail.com' });
  if (exists) {
    await User.findByIdAndUpdate(exists._id, { role: 'admin', approved: true });
    console.log('✅ Admin account updated');
  } else {
    const hash = await bcrypt.hash('Ken2004west#', 12);
    await User.create({ name: 'Kenneth (Admin)', email: 'kenwestzm@gmail.com', password: hash, role: 'admin', approved: true });
    console.log('✅ Admin account created');
  }
  console.log('Email: kenwestzm@gmail.com');
  console.log('Password: Ken2004west#');
  process.exit(0);
}
seed().catch(e => { console.error(e.message); process.exit(1); });
