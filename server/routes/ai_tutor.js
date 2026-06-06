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

// ── PRIMARY: Groq (fastest) ──────────────────────────
async function callGroq(systemPrompt, userMessage, history = [], maxTokens = 300) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('NO_GROQ_KEY');

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' })),
    { role: 'user', content: userMessage }
  ];

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages,
      max_tokens: maxTokens,
      temperature: 0.75
    })
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Groq error:', err.substring(0, 200));
    throw new Error('GROQ_FAILED');
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('GROQ_EMPTY');
  return text;
}

// ── BACKUP 1: OpenRouter ─────────────────────────────
async function callOpenRouter(systemPrompt, userMessage, history = [], maxTokens = 300) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('NO_OPENROUTER_KEY');

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' })),
    { role: 'user', content: userMessage }
  ];

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': 'https://peacemindsetgcezm.vercel.app',
      'X-Title': 'Peace Mindset School'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      messages,
      max_tokens: maxTokens,
      temperature: 0.75
    })
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('OpenRouter error:', err.substring(0, 200));
    throw new Error('OPENROUTER_FAILED');
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OPENROUTER_EMPTY');
  return text;
}

// ── BACKUP 2: Gemini ─────────────────────────────────
async function callGemini(systemPrompt, userMessage, history = [], maxTokens = 300) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('NO_GEMINI_KEY');

  const contents = [
    ...history.slice(-6).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }]
    })),
    { role: 'user', parts: [{ text: systemPrompt + '\n\nStudent says: ' + userMessage }] }
  ];

  for (const model of ['gemini-2.0-flash', 'gemini-1.5-flash-8b']) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.75, topP: 0.9 },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
          ]
        })
      }
    );
    if (response.ok) {
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    }
    const errText = await response.text().catch(() => '');
    if (!errText.includes('RESOURCE_EXHAUSTED')) break;
    console.warn(`${model} quota exhausted, trying next...`);
  }
  throw new Error('GEMINI_FAILED');
}

// ── MAIN: Try all providers in order ────────────────
async function callAI(systemPrompt, userMessage, history = [], maxTokens = 300) {
  const providers = [
    { name: 'Groq', fn: callGroq },
    { name: 'OpenRouter', fn: callOpenRouter },
    { name: 'Gemini', fn: callGemini }
  ];

  for (const provider of providers) {
    try {
      console.log(`Trying ${provider.name}...`);
      const text = await provider.fn(systemPrompt, userMessage, history, maxTokens);
      console.log(`✅ ${provider.name} responded`);
      return text;
    } catch (e) {
      console.warn(`❌ ${provider.name} failed:`, e.message);
    }
  }

  return "Good question! I will explain this in our next class. Keep studying hard!";
}

// ── POST /api/ai/chat ────────────────────────────────
router.post('/chat', auth, async (req, res) => {
  try {
    const { message, subject, character, lesson_context, conversation_history } = req.body;
    const ch = AI[character] || AI.ken;
    const history = (conversation_history || []).slice(-6).map(m => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: m.text || m.content || ''
    }));
    const prompt = buildPrompt(ch, subject, lesson_context);
    const reply = await callAI(prompt, message, history, 300);
    res.json({ reply, character: ch.name });
  } catch (e) {
    console.error('AI chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ai/generate-questions ──────────────────
router.post('/generate-questions', auth, tutorOrAdmin, async (req, res) => {
  try {
    const { subject, topic, count = 10, type = 'mcq' } = req.body;
    const prompt = `You are an expert GCE O-Level teacher in Zambia. Generate exactly ${count} ${type.toUpperCase()} questions about "${topic || subject}" for Zambian students.

RESPOND WITH ONLY VALID JSON - no markdown, no explanation:
{
  "questions": [
    {
      "question": "question text",
      "type": "${type}",
      "options": ["A. option1", "B. option2", "C. option3", "D. option4"],
      "correct_answer": "A",
      "explanation": "brief explanation"
    }
  ]
}`;

    const raw = await callAI(prompt, `Generate ${count} ${type} questions for ${subject}`, [], 1000);
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);
  } catch (e) {
    console.error('Generate questions error:', e.message);
    res.status(500).json({ error: 'Could not generate questions. Please try again.' });
  }
});

// ── POST /api/ai/class-response ──────────────────────
router.post('/class-response', auth, async (req, res) => {
  try {
    const { question, subject, character, lesson_context, class_context } = req.body;
    const ch = AI[character] || AI.ken;
    const prompt = buildPrompt(ch, subject, lesson_context);
    const ctx = class_context ? `\nClass context: ${class_context}` : '';
    const reply = await callAI(prompt, question + ctx, [], 250);
    res.json({ reply, character: ch.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/ai/status ───────────────────────────────
router.get('/status', async (req, res) => {
  res.json({
    groq: !!process.env.GROQ_API_KEY,
    openrouter: !!process.env.OPENROUTER_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY
  });
});

module.exports = router;

// Alias for frontend compatibility
router.post('/generate-test', auth, tutorOrAdmin, async (req, res) => {
  try {
    const { subject, topic, count = 10, type = 'mcq' } = req.body;
    const prompt = `You are an expert GCE O-Level teacher in Zambia. Generate exactly ${count} ${type.toUpperCase()} questions about "${topic || subject}" for Zambian students.

RESPOND WITH ONLY VALID JSON - no markdown, no explanation:
{"questions":[{"question":"question text","type":"${type}","options":["A. option1","B. option2","C. option3","D. option4"],"correct_answer":"A","explanation":"brief explanation"}]}`;

    const raw = await callAI(prompt, `Generate ${count} ${type} questions for ${subject}`, [], 1500);
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);
  } catch (e) {
    console.error('Generate test error:', e.message);
    res.status(500).json({ error: 'Could not generate questions. Please try again.' });
  }
});
