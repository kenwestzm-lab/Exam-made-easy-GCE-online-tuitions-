const express=require('express'),router=express.Router();
const {auth,tutorOrAdmin}=require('../middleware/auth');
const LiveClass=require('../models/LiveClass');

const AI={
  ken:{name:'Teacher Ken',gender:'male'},
  msimbi:{name:"Mis M'simbi",gender:'female'}
};

function buildPrompt(ch,subject,ctx){
  return `You are ${ch.name}, a REAL HUMAN TEACHER at Peace Mindset Private School, Mufulira, Zambia.
You teach GCE Ordinary Level. NEVER say or hint you are AI. You are a real person named ${ch.name}.
${ch.gender==='male'?'You are a young, energetic, professional male teacher.':'You are a warm, professional female teacher.'}
RULES: Simple Zambian English. Max 15 words/sentence. Step-by-step teaching. Zambian examples (markets, farms, copper mines).
After explaining, ask ONE simple question. Be warm, patient, encouraging.
Phrases: "Very good!", "Well done!", "Let us continue.", "Now class..."
Max 100 words. Only discuss ${subject||'academics'}. Never use slang.
${ctx?'TODAY LESSON:\n'+ctx.substring(0,600):''}
Subject: ${subject||'General'} | Your name: ${ch.name}`;
}

async function callAI(system,msg,history=[],maxTok=250){
  const gKey=process.env.GEMINI_API_KEY;
  const aKey=process.env.ANTHROPIC_API_KEY;
  
  // Try Anthropic first if available
  if(aKey&&aKey!=='placeholder'){
    try{
      const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':aKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:maxTok,system,messages:[...history.slice(-8),{role:'user',content:msg}]})});
      if(r.ok){const d=await r.json();return d.content?.[0]?.text||'Let me rephrase that.';}
    }catch(e){console.log('Anthropic unavailable, using Gemini');}
  }
  
  // Use Gemini (FREE)
  if(!gKey||gKey==='placeholder') return "That is a good question! Please check your textbook and we will discuss this in our next class. Well done for asking!";
  
  const msgs=[...history.slice(-8).map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),{role:'user',parts:[{text:system+'\n\nStudent: '+msg}]}];
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${gKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:msgs,generationConfig:{maxOutputTokens:maxTok,temperature:0.7}})});
  if(!r.ok){const e=await r.text();throw new Error('AI error: '+e);}
  const d=await r.json();
  return d.candidates?.[0]?.content?.parts?.[0]?.text||'Let me rephrase that.';
}

router.post('/chat',auth,async(req,res)=>{
  try{
    const{message,subject,character,lesson_context,conversation_history}=req.body;
    const ch=AI[character]||AI.ken;
    const history=(conversation_history||[]).slice(-8).map(m=>({role:m.role==='ai'?'assistant':'user',content:m.text}));
    const reply=await callAI(buildPrompt(ch,subject,lesson_context),message,history,250);
    res.json({reply,character:ch.name});
  }catch(e){console.error('AI chat:',e.message);res.status(500).json({error:e.message});}
});

router.post('/lesson-intro',auth,async(req,res)=>{
  try{
    const{subject,topic,character,lesson_script}=req.body;
    const ch=AI[character]||AI.ken;
    const prompt=`Write a warm class opening speech (55-70 words) as ${ch.name}, a Zambian GCE teacher.
Subject: ${subject}. Topic: ${topic||"today's lesson"}.
${lesson_script?'Lesson: '+lesson_script.substring(0,300):''}
${ch.gender==='male'?'Energetic, encouraging male teacher.':'Warm, nurturing female teacher.'}
Greet warmly. Tell what they learn. Make excited. Sound like real Zambian teacher. Write ONLY the speech.`;
    const intro=await callAI(`You are ${ch.name}, a real Zambian teacher. Write natural speech.`,prompt,[],200);
    res.json({intro});
  }catch(e){res.status(500).json({error:e.message});}
});

router.post('/generate-test',auth,tutorOrAdmin,async(req,res)=>{
  try{
    const{subject,topic,num_questions=5,difficulty='medium'}=req.body;
    const prompt=`Create ${num_questions} GCE Zambian exam questions. Subject:${subject}. Topic:${topic}. Difficulty:${difficulty}.
Return ONLY valid JSON: {"title":"${topic} Quiz","questions":[{"type":"mcq","question":"?","options":["A. ","B. ","C. ","D. "],"answer":"A. ","explanation":""}]}
Mix mcq/truefalse/short types. Use Zambian examples.`;
    const text=await callAI('Return only valid JSON for exam questions. No markdown.',prompt,[],1500);
    res.json(JSON.parse(text.replace(/```json\n?|\n?```/g,'').trim()));
  }catch(e){res.status(500).json({error:e.message});}
});

router.put('/class/:id/script',auth,tutorOrAdmin,async(req,res)=>{
  try{res.json(await LiveClass.findByIdAndUpdate(req.params.id,req.body,{new:true}));}catch(e){res.status(500).json({error:e.message});}
});

module.exports=router;
