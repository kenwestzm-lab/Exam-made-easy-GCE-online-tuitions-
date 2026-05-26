require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const connectDB = require('./config/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST','PUT','DELETE'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.set('io', io);
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Health check ──────────────────────────────────────
app.get('/api/health', (req, res) => {
  const gKey = process.env.GEMINI_API_KEY;
  const validGemini = gKey && gKey.startsWith('AIza') && gKey.length > 20;
  console.log('Health check - Gemini key valid:', validGemini, gKey ? gKey.substring(0,12)+'...' : 'NOT SET');
  res.json({
    status: 'ok',
    server: 'Peace Mindset API v5 - Live Classroom',
    gemini: (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.startsWith('AIza')) ? 'configured' : 'MISSING - add AIzaSy... key in Render Environment',
    cloudinary: process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_CLOUD_NAME !== '' ? 'configured' : 'missing',
    time: new Date().toISOString()
  });
});

// ── Routes ────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/materials', require('./routes/materials'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/tests', require('./routes/tests'));
app.use('/api/ai', require('./routes/ai_tutor'));
app.use('/api', require('./routes/misc'));

// ── Socket.IO Real-time ───────────────────────────────
io.on('connection', (socket) => {
  console.log('🔌 Connected:', socket.id);

  socket.on('join_class', ({ classId, user }) => {
    socket.join(`class_${classId}`);
    if (user?._id) socket.join(`user_${user._id}`);
    socket.to(`class_${classId}`).emit('student_joined', { user });
  });

  socket.on('leave_class', ({ classId, userId }) => {
    socket.leave(`class_${classId}`);
    socket.to(`class_${classId}`).emit('student_left', { userId });
  });

  socket.on('join_group', (subjectId) => {
    socket.join(`group_${subjectId}`);
  });

  socket.on('class_question', (data) => {
    socket.to(`class_${data.classId}`).emit('class_question', data);
  });

  socket.on('hand_raise', (data) => {
    socket.to(`class_${data.classId}`).emit('hand_raise', data);
  });

  socket.on('whiteboard_stroke', ({ classId, stroke }) => {
    socket.to(`class_${classId}`).emit('whiteboard_stroke', stroke);
  });

  socket.on('whiteboard_clear', ({ classId }) => {
    socket.to(`class_${classId}`).emit('whiteboard_clear');
  });

  socket.on('whiteboard_full_sync', ({ classId, strokes }) => {
    socket.to(`class_${classId}`).emit('whiteboard_full_sync', { strokes });
  });

  socket.on('ai_speaking', (data) => {
    socket.to(`class_${data.classId}`).emit('ai_speaking', data);
  });

  socket.on('ai_done_speaking', (data) => {
    socket.to(`class_${data.classId}`).emit('ai_done_speaking', data);
  });

  // Live Quiz
  socket.on('class_quiz', ({ classId, ...quiz }) => {
    socket.to(`class_${classId}`).emit('class_quiz', quiz);
  });

  socket.on('student_quiz_done', ({ classId, ...data }) => {
    socket.to(`class_${classId}`).emit('student_quiz_done', data);
  });

  // Announcements
  socket.on('class_announcement', ({ classId, text, type }) => {
    io.to(`class_${classId}`).emit('class_announcement', { text, type });
  });

  // AI correction broadcast
  socket.on('ai_correction', ({ classId, ...data }) => {
    io.to(`class_${classId}`).emit('ai_correction', data);
  });

  // Class status
  socket.on('class_status_change', (data) => {
    io.to(`class_${data.classId}`).emit('class_status_change', data);
  });

  // Auto-start AI class at scheduled time
  socket.on('check_auto_start', async ({ classId }) => {
    try {
      const { LiveClass } = require('./models');
      const cls = await LiveClass.findById(classId);
      if (cls?.auto_start && cls?.status === 'upcoming' && cls?.scheduled_date && cls?.scheduled_time) {
        const sched = new Date(`${cls.scheduled_date}T${cls.scheduled_time}:00`);
        if (new Date() >= sched) {
          await LiveClass.findByIdAndUpdate(classId, { status: 'live' });
          io.to(`class_${classId}`).emit('class_status_change', { status: 'live', classId });
          console.log('⏰ Auto-started:', cls.title);
        }
      }
    } catch(e) { console.error('Auto-start error:', e.message); }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Disconnected:', socket.id);
  });
});

// ── Start server ──────────────────────────────────────
const PORT = process.env.PORT || 10000;
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`✅ Peace Mindset Server v5 running on port ${PORT}`);
    console.log(`   Gemini: ${process.env.GEMINI_API_KEY ? '✅' : '❌ Missing'}`);
    console.log(`   Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME ? '✅' : '❌ Missing'}`);
  });
}).catch(e => {
  console.error('❌ DB connection failed:', e.message);
  process.exit(1);
});
