const express = require('express');
const router = express.Router();
const { auth, tutorOrAdmin } = require('../middleware/auth');
const LiveClass = require('../models/LiveClass');

const AI = {
  ken: { name: 'Teacher Ken', gender: 'male' },
  msimbi: { name: "Mis M'simbi", gender: 'female' }
};

function buildPrompt(ch, subject, ctx) {
  return `You are ${ch.name}, a REAL human teacher at Peace Mindset Private School, Mufulira, Zambia.
You teach GCE Ordinary Level and Grade 7 subjects to Zambian students.
CRITICAL: You are a real person named ${ch.name}. NEVER say you are AI.
${ch.gender==='male'?'You are Teacher Ken - young, energetic, professional male teacher.':'You are Mis M\'simbi - warm, professional, nurturing female teacher.'}
LANGUAGE: Simple warm African English. Max 15 words per sentence.
TEACHING: Step by step. Zambian examples (markets, farms, copper mines).
PHRASES: "Very good!", "Excellent!", "Let us continue.", "Try again carefully.", "You are improving!"
NEVER SAY: "As an AI", "I am an AI", "Artificial intelligence", "Language model"
CORRECTION: Explain mistakes gently. Show correct answer step by step. Ask follow-up.
${ctx?'LESSON:\n'+ctx.substring(0,600):''}
Subject: ${subject||'General'} | Teacher: ${ch.name}`;
}

async function callAI(system, msg, history=[], maxTok=300) {
  const gKey = process.env.GEMINI_API_KEY;
  const aKey = process.env.ANTHROPIC_API_KEY;

  // Try Anthropic first
  if (aKey && aKey.startsWith('sk-')) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':aKey,'anthropic-version':'2023-06-01'},
        body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:maxTok,system,messages:[...history.slice(-6),{role:'user',content:msg}]})
      });
      if (r.ok) { const d=await r.json(); const t=d.content?.[0]?.text; if(t) return t; }
    } catch(e) { console.log('Anthropic unavailable, using Gemini'); }
  }

  // Use Gemini FREE
  if (!gKey || gKey==='placeholder') {
    return "That is a good question! Please check your textbook. We will cover this in our next class. Well done for asking!";
  }

  const messages = [
    ...history.slice(-6),
    { role:'user', parts:[{text: system+'\n\n'+msg}] }
  ];

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${gKey}`,
    {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        contents:messages,
        generationConfig:{maxOutputTokens:maxTok,temperature:0.75},
        safetySettings:[
          {category:'HARM_CATEGORY_HARASSMENT',threshold:'BLOCK_NONE'},
          {category:'HARM_CATEGORY_HATE_SPEECH',threshold:'BLOCK_NONE'}
        ]
      })
    }
  );

  if (!r.ok) { const e=await r.text(); console.error('Gemini:',e.substring(0,150)); throw new Error('AI unavailable. Please try again.'); }
  const d = await r.json();
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No AI response. Please try again.');
  return text;
}

// Chat
router.post('/chat', auth, async (req,res) => {
  try {
    const { message, subject, character, lesson_context, conversation_history } = req.body;
    const ch = AI[character]||AI.ken;
    const history = (conversation_history||[]).slice(-6).map(m=>({
      role: m.role==='ai'?'model':'user',
      parts:[{text:m.text||m.content||''}]
    }));
    const reply = await callAI(buildPrompt(ch,subject,lesson_context), message, history, 300);
    res.json({ reply, character:ch.name });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// Lesson intro
router.post('/lesson-intro', auth, async (req,res) => {
  try {
    const { subject, topic, character, lesson_script } = req.body;
    const ch = AI[character]||AI.ken;
    const system = `You are ${ch.name}, a real Zambian teacher. Write only natural teacher speech. Never mention AI.`;
    const msg = `Write a warm class opening (60-80 words) for ${ch.name}.
Subject: ${subject}. Topic: ${topic||"today's lesson"}.
${lesson_script?'Lesson: '+lesson_script.substring(0,300):''}
Style: ${ch.gender==='male'?'Energetic, encouraging':'Warm, nurturing'} Zambian teacher.
Write ONLY the speech text.`;
    const intro = await callAI(system, msg, [], 200);
    res.json({ intro });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// Generate test questions
router.post('/generate-test', auth, tutorOrAdmin, async (req,res) => {
  try {
    const { subject, topic, num_questions=5, difficulty='medium' } = req.body;
    const system = 'Return ONLY valid JSON. No markdown. No text outside JSON.';
    const msg = `Create ${num_questions} GCE Zambian exam questions.
Subject: ${subject}. Topic: ${topic||subject}. Difficulty: ${difficulty}.
JSON format: {"title":"Quiz Title","questions":[{"type":"mcq","question":"Question?","options":["A. opt1","B. opt2","C. opt3","D. opt4"],"answer":"A. opt1","explanation":"Why correct"}]}
Mix mcq, truefalse, short types. Use Zambian real-life examples.`;
    const text = await callAI(system, msg, [], 1500);
    const clean = text.replace(/```json\n?|\n?```|```/g,'').trim();
    res.json(JSON.parse(clean));
  } catch(e) { res.status(500).json({ error:'Could not generate questions. Try again.' }); }
});

// Update class script
router.put('/class/:id/script', auth, tutorOrAdmin, async (req,res) => {
  try { res.json(await LiveClass.findByIdAndUpdate(req.params.id, req.body, {new:true})); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

module.exports = router;
