require('dotenv').config({path:require('path').join(__dirname,'.env')});
const express=require('express');
const http=require('http');
const{Server}=require('socket.io');
const cors=require('cors');
const path=require('path');
const connectDB=require('./config/db');

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:'*'}});
app.set('io',io);

io.on('connection',(socket)=>{
  const uid=socket.handshake.query.userId;
  if(uid)socket.join('user_'+uid);
  socket.on('join_group',(id)=>socket.join('group_'+id));
  socket.on('join_class',({classId,user})=>{socket.join('class_'+classId);socket.to('class_'+classId).emit('user_joined_class',user);});
  socket.on('typing',({to,user,isTyping})=>socket.to('user_'+to).emit('typing',{user,isTyping}));
});

app.use(cors({origin:'*',credentials:true}));
app.use(express.json({limit:'50mb'}));
app.use(express.urlencoded({extended:true,limit:'50mb'}));

app.use('/api/auth',require('./routes/auth'));
app.use('/api/users',require('./routes/users'));
app.use('/api/materials',require('./routes/materials'));
app.use('/api/assignments',require('./routes/assignments'));
app.use('/api/tests',require('./routes/tests'));
app.use('/api/subscriptions',require('./routes/subscriptions'));
app.use('/api',require('./routes/misc'));

app.get('/api/health',(_req,res)=>res.json({status:'ok',school:'Peace Mindset Private School',country:'Zambia'}));

// Serve built React app
const buildPath=path.join(__dirname,'../client/dist');
app.use(express.static(buildPath));
app.get('*',(_req,res)=>{
  const indexPath=path.join(buildPath,'index.html');
  res.sendFile(indexPath,(err)=>{
    if(err)res.json({status:'API running',docs:'/api/health'});
  });
});

const PORT=process.env.PORT||5000;
connectDB().then(()=>{
  server.listen(PORT,'0.0.0.0',()=>{
    console.log('');
    console.log('🎓 =====================================');
    console.log('🏫  PEACE MINDSET PRIVATE SCHOOL');
    console.log('🇿🇲  GCE Online Platform - Zambia');
    console.log('🚀  Running on port '+PORT);
    console.log('💚  MongoDB: Connected');
    console.log('📱  WhatsApp: 0772799672');
    console.log('🎓 =====================================');
    console.log('');
  });
}).catch(e=>{console.error('MongoDB failed:',e.message);process.exit(1);});
