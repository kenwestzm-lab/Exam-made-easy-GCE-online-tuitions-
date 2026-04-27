require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve frontend
app.use(express.static(path.join(__dirname, '../public')));

// Socket.IO events
io.on('connection', (socket) => {
  const uid = socket.handshake.query.userId;
  if (uid) socket.join(`user_${uid}`);
  socket.on('join_group', id => socket.join(`group_${id}`));
  socket.on('join_class', ({ classId, user }) => {
    socket.join(`class_${classId}`);
    socket.to(`class_${classId}`).emit('student_joined', { user });
  });
  socket.on('leave_class', ({ classId, userId }) => {
    socket.leave(`class_${classId}`);
    socket.to(`class_${classId}`).emit('student_left', { userId });
  });
  socket.on('whiteboard_stroke', ({ classId, stroke }) => socket.to(`class_${classId}`).emit('whiteboard_stroke', stroke));
  socket.on('whiteboard_clear', ({ classId }) => socket.to(`class_${classId}`).emit('whiteboard_clear'));
  socket.on('whiteboard_full_sync', ({ classId, strokes }) => socket.to(`class_${classId}`).emit('whiteboard_full_sync', { strokes }));
  socket.on('ai_speaking', ({ classId, text, character }) => socket.to(`class_${classId}`).emit('ai_speaking', { text, character }));
  socket.on('ai_done_speaking', ({ classId }) => socket.to(`class_${classId}`).emit('ai_done_speaking'));
  socket.on('class_question', ({ classId, question, studentName }) => io.to(`class_${classId}`).emit('class_question', { question, studentName }));
  socket.on('hand_raise', ({ classId, userId, name, raised }) => socket.to(`class_${classId}`).emit('hand_raise', { userId, name, raised }));
  socket.on('typing', ({ to, user, isTyping }) => socket.to(`user_${to}`).emit('typing', { user, isTyping }));
  socket.on('check_auto_start', async ({ classId }) => {
    try {
      const LiveClass = require('./models/LiveClass');
      const cls = await LiveClass.findById(classId);
      if (cls && cls.auto_start && cls.status === 'upcoming') {
        const now = new Date();
        const sched = new Date(`${cls.scheduled_date}T${cls.scheduled_time}`);
        if (now >= sched) {
          cls.status = 'live'; await cls.save();
          io.to(`class_${classId}`).emit('class_status_change', { status: 'live', classId });
        }
      }
    } catch(e) {}
  });
  socket.on('disconnect', () => {});
});

// Routes
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/materials',     require('./routes/materials'));
app.use('/api/assignments',   require('./routes/assignments'));
app.use('/api/tests',         require('./routes/tests'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/ai',            require('./routes/ai_tutor'));
app.use('/api',               require('./routes/misc'));

app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  school: 'Peace Mindset Private School - Zambia',
  ai: process.env.ANTHROPIC_API_KEY ? 'Teacher Ken & Mis Msimbi ACTIVE' : 'Add ANTHROPIC_API_KEY to enable AI',
  time: new Date().toISOString()
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'), err => {
    if (err) res.json({ status: 'API ok', health: '/api/health' });
  });
});

const PORT = process.env.PORT || 5000;
connectDB().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('🎓 =========================================');
    console.log('🏫  PEACE MINDSET PRIVATE SCHOOL - ZAMBIA');
    console.log(`🚀  Port: ${PORT}`);
    console.log(`🤖  AI Tutor: ${process.env.ANTHROPIC_API_KEY ? '✅ ACTIVE' : '❌ Needs ANTHROPIC_API_KEY'}`);
    console.log('🎓 =========================================');
  });
}).catch(e => { console.error('Failed:', e.message); process.exit(1); });
