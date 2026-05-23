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
  pingTimeout: 60000, pingInterval: 25000
});

app.set('io', io);
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/api/health', (req,res) => res.json({
  status: 'ok', server: 'Peace Mindset API v5',
  gemini: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY!=='placeholder' ? 'configured' : 'missing',
  cloudinary: !!process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_CLOUD_NAME!=='' ? 'configured' : 'missing',
  time: new Date().toISOString()
}));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/materials', require('./routes/materials'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/tests', require('./routes/tests'));
app.use('/api/ai', require('./routes/ai_tutor'));
app.use('/api', require('./routes/misc'));

// Socket.IO
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join_class', ({ classId, user }) => {
    socket.join(`class_${classId}`);
    if (user?._id) {
      socket.join(`user_${user._id}`);
      socket.to(`class_${classId}`).emit('student_joined', { user });
      console.log(`${user.name} joined class ${classId}`);
    }
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

  socket.on('whiteboard_stroke', (data) => {
    socket.to(`class_${data.classId}`).emit('whiteboard_stroke', data.stroke);
  });

  socket.on('whiteboard_clear', (data) => {
    socket.to(`class_${data.classId}`).emit('whiteboard_clear');
  });

  socket.on('ai_speaking', (data) => {
    socket.to(`class_${data.classId}`).emit('ai_speaking', data);
  });

  socket.on('ai_done_speaking', (data) => {
    socket.to(`class_${data.classId}`).emit('ai_done_speaking', data);
  });

  socket.on('class_status_change', (data) => {
    io.to(`class_${data.classId}`).emit('class_status_change', data);
  });

  socket.on('class_quiz', ({ classId, ...quiz }) => {
    socket.to(`class_${classId}`).emit('class_quiz', quiz);
  });

  socket.on('class_announcement', ({ classId, text, type }) => {
    io.to(`class_${classId}`).emit('class_announcement', { text, type });
  });

  socket.on('student_quiz_done', ({ classId, ...data }) => {
    socket.to(`class_${classId}`).emit('student_quiz_done', data);
  });

  socket.on('ai_correction', ({ classId, ...data }) => {
    io.to(`class_${classId}`).emit('ai_correction', data);
  });

  socket.on('check_auto_start', async ({ classId }) => {
    try {
      const { LiveClass } = require('./models');
      const cls = await LiveClass.findById(classId);
      if (cls?.auto_start && cls?.status === 'upcoming') {
        const sched = new Date(cls.scheduled_date + 'T' + cls.scheduled_time + ':00');
        if (new Date() >= sched) {
          await LiveClass.findByIdAndUpdate(classId, { status: 'live' });
          io.to(`class_${classId}`).emit('class_status_change', { status: 'live' });
          console.log('Auto-started class:', cls.title);
        }
      }
    } catch(e) { console.error('Auto-start error:', e.message); }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 10000;
connectDB().then(() => {
  server.listen(PORT, () => console.log(`✅ Peace Mindset Server v5 running on port ${PORT}`));
}).catch(e => { console.error('DB connection failed:', e.message); process.exit(1); });
