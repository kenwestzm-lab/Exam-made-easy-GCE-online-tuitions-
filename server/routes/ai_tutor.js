const express=require('express'),router=express.Router();
const {auth,tutorOrAdmin}=require('../middleware/auth');
const LiveClass=require('../models/LiveClass');

const AI_CHARS={
  ken:{name:'Teacher Ken',gender:'male',style:'energetic and encouraging, like a young Zambian male teacher'},
  msimbi:{name:"Mis M'simbi",gender:'female',style:'warm and nurturing, like a professional Zambian female teacher'}
};

async function callClaude(systemPrompt, userMessage, history=[], maxTokens=300) {
  const apiKey=process.env.ANTHROPIC_API_KEY;
  if(!apiKey||apiKey==='placeholder') throw new Error('ANTHROPIC_API_KEY not configured on server. Add it in Render environment variables.');
  const messages=[...history.slice(-8),{role:'user',content:userMessage}];
  const r=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:maxTokens,system:systemPrompt,messages})
  });
  if(!r.ok){const e=await r.text();throw new Error(`Claude API error: ${e}`);}
  const d=await r.json();
  return d.content?.[0]?.text||'I apologise, let me rephrase that.';
}

// POST /api/ai/chat — AI teacher responds
router.post('/chat',auth,async(req,res)=>{
  try{
    const{message,subject,character,lesson_context,conversation_history}=req.body;
    const ch=AI_CHARS[character]||AI_CHARS.ken;
    const system=`You are ${ch.name}, a ${ch.style} at Peace Mindset Private School in Lusaka, Zambia.
You teach GCE (General Certificate of Education) Ordinary Level — the Zambian school curriculum.

IMPORTANT RULES:
1. Speak clear, simple English — the way an educated Zambian teacher speaks. NOT too fast. Calm and clear.
2. NEVER say you are an AI, robot, or computer program. You are a real teacher.
3. ONLY discuss ${subject||'academic topics'}. If asked about anything else, say: "Let us focus on our lesson today."
4. When teaching, give step-by-step explanations with examples from Zambia daily life.
5. Keep your response short enough to say out loud — maximum 120 words.
6. After explaining something, always ask one question to check if students understand.
7. Be encouraging and patient with students.
${ch.gender==='male'?'8. Occasionally say: "Very good!" or "Excellent!" or "Now class, let us continue."':'8. Occasionally say: "Well done!" or "That is correct!" or "Now class, pay attention."'}
${lesson_context?`\nTODAY\'S LESSON:\n${lesson_context.substring(0,800)}`:''}
Subject: ${subject||'General'} | Your name: ${ch.name}`;
    const history=(conversation_history||[]).slice(-8).map(m=>({role:m.role==='ai'?'assistant':'user',content:m.text}));
    const reply=await callClaude(system,message,history,250);
    res.json({reply,character:ch.name});
  }catch(e){console.error('AI chat error:',e.message);res.status(500).json({error:e.message});}
});

// POST /api/ai/lesson-intro — AI generates class opening speech
router.post('/lesson-intro',auth,async(req,res)=>{
  try{
    const{subject,topic,character,lesson_script}=req.body;
    const ch=AI_CHARS[character]||AI_CHARS.ken;
    const prompt=`Write a short, friendly class opening speech (50-70 words) for ${ch.name}, a Zambian GCE teacher.
Subject: ${subject}. Topic: ${topic||'today\'s lesson'}.
${lesson_script?`Lesson content: ${lesson_script.substring(0,400)}`:''}
Style: ${ch.style}. Start by greeting the class warmly. Tell them what they will learn. Make them excited to learn.
Write naturally, like a real Zambian teacher speaking — not robotic, not too formal.`;
    const intro=await callClaude('You write natural teacher speech in simple clear English like a Zambian teacher.',prompt,[],150);
    res.json({intro});
  }catch(e){res.status(500).json({error:e.message});}
});

// POST /api/ai/generate-test — AI creates test questions
router.post('/generate-test',auth,tutorOrAdmin,async(req,res)=>{
  try{
    const{subject,topic,num_questions=5,difficulty='medium'}=req.body;
    const prompt=`Create ${num_questions} GCE Ordinary Level exam questions for Zambian students.
Subject: ${subject}. Topic: ${topic}. Difficulty: ${difficulty}.
Return ONLY valid JSON, no markdown, no explanation:
{"title":"${topic} Quiz","questions":[{"type":"mcq","question":"Question here?","options":["A. option1","B. option2","C. option3","D. option4"],"answer":"A. option1","explanation":"Why this is correct"}]}
Mix mcq, truefalse, and short answer question types.`;
    const text=await callClaude('You create exam questions and return only valid JSON.',prompt,[],1000);
    const clean=text.replace(/```json\n?|\n?```/g,'').trim();
    res.json(JSON.parse(clean));
  }catch(e){res.status(500).json({error:e.message});}
});

// PUT /api/ai/class/:id/script — tutor uploads lesson script for AI
router.put('/class/:id/script',auth,tutorOrAdmin,async(req,res)=>{
  try{
    const{lesson_script,ai_character,auto_start,presenter_type,class_type,lesson_topic}=req.body;
    const cls=await LiveClass.findByIdAndUpdate(req.params.id,{lesson_script,ai_character,auto_start,presenter_type,class_type,lesson_topic},{new:true});
    res.json(cls);
  }catch(e){res.status(500).json({error:e.message});}
});

module.exports=router;
