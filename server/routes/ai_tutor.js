const express = require('express');
const router = express.Router();
const { auth, tutorOrAdmin } = require('../middleware/auth');
const LiveClass = require('../models/LiveClass');
const { upload, uploadToCloudinary } = require('../config/cloudinary');

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

// ── BACKUP 3: Together AI (free tier) ───────────────
async function callTogether(systemPrompt, userMessage, history = [], maxTokens = 300) {
  const key = process.env.TOGETHER_API_KEY;
  if (!key) throw new Error('NO_TOGETHER_KEY');
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' })),
    { role: 'user', content: userMessage }
  ];
  const response = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model: 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo', messages, max_tokens: maxTokens, temperature: 0.75 })
  });
  if (!response.ok) throw new Error('TOGETHER_FAILED');
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('TOGETHER_EMPTY');
  return text;
}

// ── BACKUP 4: Mistral AI (free tier) ─────────────────
async function callMistral(systemPrompt, userMessage, history = [], maxTokens = 300) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('NO_MISTRAL_KEY');
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' })),
    { role: 'user', content: userMessage }
  ];
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model: 'mistral-small-latest', messages, max_tokens: maxTokens, temperature: 0.75 })
  });
  if (!response.ok) throw new Error('MISTRAL_FAILED');
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('MISTRAL_EMPTY');
  return text;
}

// ── MAIN: Try all providers in order ────────────────
async function callAI(systemPrompt, userMessage, history = [], maxTokens = 300) {
  const providers = [
    { name: 'Groq', fn: callGroq },
    { name: 'OpenRouter', fn: callOpenRouter },
    { name: 'Gemini', fn: callGemini },
    { name: 'Together', fn: callTogether },
    { name: 'Mistral', fn: callMistral }
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

  return "That is a great question! Let me think about this carefully. Please ask again in a moment.";
}

// ── POST /api/ai/chat ────────────────────────────────
router.post('/chat', auth, async (req, res) => {
  try {
    const { message, subject, character, lesson_context, conversation_history, image_base64 } = req.body;
    const ch = AI[character] || AI.ken;
    const history = (conversation_history || []).slice(-6).map(m => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: m.text || m.content || ''
    }));
    const prompt = buildPrompt(ch, subject, lesson_context);
    
    let reply;
    if (image_base64) {
      // Use Groq vision or describe image context
      const imgPrompt = prompt + '\n\nA student has sent you an image with their question. Describe what you see and help them understand it as a teacher would.';
      // Try Groq with image description fallback
      try {
        const groqReply = await callGroq(imgPrompt, message + ' [Student sent an image/photo of their question or problem]', history, 400);
        reply = groqReply;
      } catch(e) {
        reply = await callAI(imgPrompt, message, history, 400);
      }
    } else {
      reply = await callAI(prompt, message, history, 300);
    }
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

// ── Vision-capable Gemini call (image + text) ────────
async function callGeminiVision(prompt, base64Image, mimeType) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('NO_GEMINI_KEY');

  const contents = [{
    role: 'user',
    parts: [
      { text: prompt },
      { inline_data: { mime_type: mimeType, data: base64Image } }
    ]
  }];

  for (const model of ['gemini-2.0-flash', 'gemini-1.5-flash-8b']) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: 500, temperature: 0.4 },
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
    } else {
      console.warn(`Gemini vision (${model}) failed:`, await response.text().then(t => t.substring(0, 200)));
    }
  }
  throw new Error('GEMINI_VISION_FAILED');
}

// ── POST /api/ai/extract-pdf — extract text from uploaded PDF ──
router.post('/extract-pdf', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const pdfParse = require('pdf-parse');
    const ext = req.file.originalname.split('.').pop().toLowerCase();
    if (ext !== 'pdf') {
      return res.json({ text: req.file.buffer.toString('utf-8').substring(0, 4000) });
    }
    const data = await pdfParse(req.file.buffer);
    const text = (data.text || '').trim().substring(0, 6000);
    if (!text) return res.json({ text: '', error: 'No readable text found in PDF' });
    res.json({ text });
  } catch (e) {
    console.error('extract-pdf error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ai/class-image — upload image to Cloudinary, return URL ──
router.post('/class-image', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const r = await uploadToCloudinary(req.file.buffer, 'peace-mindset/class-images', 'image');
    res.json({ url: r.secure_url });
  } catch (e) {
    console.error('class-image error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ai/scan-image — Gemini vision: extract text or explain image ──
router.post('/scan-image', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const { character, subject, mode } = req.body;
    const ch = AI[character] || AI.ken;
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    const prompt = mode === 'extract_text'
      ? `Read this image carefully and extract all readable text, notes, or questions exactly as written. If it is a textbook page or handwritten notes, transcribe the content clearly so a teacher can use it to build a lesson. Subject context: ${subject || 'General'}.`
      : `You are ${ch.name}, a teacher at Peace Mindset Private School, Zambia. Look at this image (likely a diagram, question, or student's work for ${subject || 'a GCE subject'}) and explain it simply to a Zambian student in under 60 words. Speak as a real teacher, never mention AI.`;

    const result = await callGeminiVision(prompt, base64Image, mimeType);
    res.json({ result: result.trim() });
  } catch (e) {
    console.error('scan-image error:', e.message);
    res.status(500).json({ result: '', error: 'Could not scan image. Please try again.' });
  }
});

module.exports = router;


// ── POST /api/ai/lesson-intro ─────────────────────────
router.post('/lesson-intro', auth, async (req, res) => {
  try {
    const { subject, topic, character, lesson_script } = req.body;
    const ch = AI[character] || AI.ken;
    const prompt = `You are ${ch.name}, a professional teacher at Peace Mindset Private School, Mufulira, Zambia.
Write a SHORT, warm, professional class introduction (2-3 sentences only).
Subject: ${subject}. Topic: ${topic || subject}.
${lesson_script ? 'Lesson overview: ' + lesson_script.substring(0, 200) : ''}
Rules: No strange words. Sound human and warm. End with "Let us begin."
Respond with ONLY the introduction text, nothing else.`;
    const intro = await callAI(prompt, 'Write introduction', [], 150);
    res.json({ intro });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/ai/build-lesson ─────────────────────────
router.post('/build-lesson', auth, async (req, res) => {
  try {
    const { subject, topic, notes, character } = req.body;
    const ch = AI[character] || AI.ken;
    const prompt = `You are ${ch.name}, a professional GCE teacher in Zambia.
Convert these lesson notes into a structured lesson with teaching segments and questions.

Notes: ${notes.substring(0, 1500)}
Subject: ${subject}. Topic: ${topic}.

Create 8-12 chunks. Rules:
- "teach" chunks: clear explanation in simple English, 2-3 sentences max
- "question" chunks: ONE clear question that requires thinking
- Questions should wait for student response
- No strange words like "jamani" or informal slang
- Sound professional and encouraging
- Use Zambian examples where relevant

Respond with ONLY valid JSON:
{"chunks":[
  {"type":"teach","text":"explanation here"},
  {"type":"question","text":"question text","question":"full question to ask student"},
  {"type":"teach","text":"more explanation"}
]}`;
    const raw = await callAI(prompt, 'Build lesson chunks', [], 2000);
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ai/check-answer ─────────────────────────
router.post('/check-answer', auth, async (req, res) => {
  try {
    const { student_name, student_answer, question, subject, character, lesson_context } = req.body;
    const ch = AI[character] || AI.ken;
    const prompt = `You are ${ch.name}, a professional teacher at Peace Mindset Private School, Zambia.
A student just answered your question. Respond professionally and encouragingly.

Question asked: ${question}
Student (${student_name}) answered: ${student_answer}
Subject: ${subject}
Lesson context: ${(lesson_context || '').substring(0, 300)}

Rules:
- Check if the answer is correct or partially correct
- If correct: praise them specifically, add one more insight
- If wrong: gently correct, explain the right answer, encourage them
- Keep response to 3-4 sentences max
- Sound warm and professional
- No strange words
- End with encouragement`;
    const reply = await callAI(prompt, student_answer, [], 200);
    res.json({ reply, character: ch.name });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/ai/class-image ──────────────────────────
router.post('/class-image', auth, tutorOrAdmin, async (req, res) => {
  try {
    const { classId, character } = req.body;
    const { uploadToCloudinary, upload } = require('../config/cloudinary');
    // Image handled by multer
    res.json({ url: '', message: 'Use scan-image endpoint' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/ai/scan-image ───────────────────────────
router.post('/scan-image', auth, async (req, res) => {
  try {
    const { character, subject, mode } = req.body;
    const ch = AI[character] || AI.ken;
    const prompt = `You are ${ch.name}, a professional teacher. 
A student shared an image in class. Describe what you see and explain it clearly for GCE ${subject} students.
Be professional, clear and educational. Maximum 3 sentences.`;
    const result = await callAI(prompt, 'Explain this classroom image for students', [], 200);
    res.json({ result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
