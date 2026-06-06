const express = require('express');
const router = express.Router();
const { auth, tutorOrAdmin } = require('../middleware/auth');
const LiveClass = require('../models/LiveClass');

const AI = {
  ken:    { name: 'Teacher Ken',   gender: 'male' },
  msimbi: { name: "Mis M'simbi",  gender: 'female' }
};

function buildPrompt(ch, subject, ctx) {
  return `You are ${ch.name}, a REAL human teacher at Peace Mindset Private School, Mufulira, Zambia.
Teach GCE Ordinary Level and Grade 7 to Zambian students.
YOU ARE A REAL PERSON. Never say you are AI, robot, or computer.
${ch.gender==='male'
  ? 'You are Teacher Ken — energetic, confident, encouraging young male teacher.'
  : "You are Mis M'simbi — warm, caring, professional female teacher."}
SPEAK: Simple African English. Max 15 words per sentence.
TEACH: Step by step. Zambian examples (markets, farms, copper mines, rivers).
SAY: "Very good!", "Excellent!", "Let us continue.", "Try again.", "You are improving!"
NEVER SAY: "As an AI", "I am an AI", "language model", "artificial intelligence"
CORRECT: Gently explain mistake. Give correct answer step by step. Ask follow-up.
${ctx ? 'LESSON:\n' + ctx.substring(0, 600) : ''}
Subject: ${subject || 'General'} | Name: ${ch.name}`;
}

async function callGemini(systemPrompt, userMessage, history = [], maxTokens = 300) {
  const key = process.env.GEMINI_API_KEY;

  if (!key || key === '' || key === 'placeholder') {
    console.warn('⚠️  GEMINI_API_KEY not set in environment variables!');
    return "Good question! Please check your textbook and we will discuss this in our next class. Well done for asking!";
  }

  // Build Gemini message history
  const contents = [
    ...history.slice(-6).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }]
    })),
    {
      role: 'user',
      parts: [{ text: systemPrompt + '\n\nStudent says: ' + userMessage }]
    }
  ];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.75,
          topP: 0.9
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT',  threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
      })
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error('Gemini API error:', errText.substring(0, 300));
    if (errText.includes('API_KEY_INVALID')) throw new Error('Invalid Gemini API key.');
    if (errText.includes('PERMISSION_DENIED')) throw new Error('Gemini API key permission denied.');
    if (errText.includes('RESOURCE_EXHAUSTED') || errText.includes('quota')) {
      // Try fallback model
      console.warn('Quota exceeded on gemini-2.0-flash, trying fallback...');
      const r2 = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.75 } }) }
      );
      if (r2.ok) {
        const d2 = await r2.json();
        const t2 = d2.candidates?.[0]?.content?.parts?.[0]?.text;
        if (t2) return t2;
      }
      throw new Error('AI quota exceeded. Please try again in a minute.');
    }
    throw new Error('AI service error. Please try again shortly.');
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty AI response. Please try again.');
  return text;
}

// ── POST /api/ai/chat ─────────────────────────────────
router.post('/chat', auth, async (req, res) => {
  try {
    const { message, subject, character, lesson_context, conversation_history } = req.body;
    const ch = AI[character] || AI.ken;
    const history = (conversation_history || []).slice(-6).map(m => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: m.text || m.content || ''
    }));
    const reply = await callGemini(buildPrompt(ch, subject, lesson_context), message, history, 300);
    res.json({ reply, character: ch.name });
  } catch (e) {
    console.error('AI chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ai/lesson-intro ─────────────────────────
router.post('/lesson-intro', auth, async (req, res) => {
  try {
    const { subject, topic, character, lesson_script } = req.body;
    const ch = AI[character] || AI.ken;
    const system = `You are ${ch.name}, a real Zambian GCE teacher. Write ONLY the teacher speech. Never mention AI.`;
    const msg = `Write a warm class opening speech (60-80 words) as ${ch.name}.
Subject: ${subject}. Topic: ${topic || "today's lesson"}.
${lesson_script ? 'Lesson overview: ' + lesson_script.substring(0, 300) : ''}
Style: ${ch.gender === 'male' ? 'Energetic, encouraging, confident' : 'Warm, caring, professional'} Zambian teacher.
Greet class. Tell them the topic. Make them excited. Sound natural, not robotic.
WRITE ONLY THE SPEECH TEXT.`;
    const intro = await callGemini(system, msg, [], 220);
    res.json({ intro });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ai/generate-test ────────────────────────
router.post('/generate-test', auth, tutorOrAdmin, async (req, res) => {
  try {
    const { subject, topic, num_questions = 5, difficulty = 'medium' } = req.body;
    const system = 'You create GCE exam questions. Return ONLY valid JSON. No markdown. No text outside the JSON.';
    const msg = `Create exactly ${num_questions} GCE Zambian exam questions.
Subject: ${subject}. Topic: ${topic || subject}. Difficulty: ${difficulty}.
Return this exact JSON (no extra text):
{"title":"${topic || subject} Quiz","questions":[
  {"type":"mcq","question":"Question here?","options":["A. Option1","B. Option2","C. Option3","D. Option4"],"answer":"A. Option1","explanation":"Brief reason"},
  {"type":"truefalse","question":"Statement here?","options":["True","False"],"answer":"True","explanation":"Brief reason"},
  {"type":"short","question":"Question here?","answer":"Correct answer","explanation":"Brief reason"}
]}
Use Zambian real-life examples. Keep language simple for Zambian students.`;
    const text = await callGemini(system, msg, [], 2000);
    const clean = text.replace(/```json\n?|\n?```|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);
  } catch (e) {
    console.error('Generate test error:', e.message);
    res.status(500).json({ error: 'Could not generate questions. Please try again.' });
  }
});

// ── PUT /api/ai/class/:id/script ──────────────────────
router.put('/class/:id/script', auth, tutorOrAdmin, async (req, res) => {
  try {
    const cls = await LiveClass.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(cls);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
