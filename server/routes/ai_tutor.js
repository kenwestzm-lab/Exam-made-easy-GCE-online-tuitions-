const express = require('express');
const router = express.Router();
const { auth, tutorOrAdmin } = require('../middleware/auth');
const LiveClass = require('../models/LiveClass');
const { upload, uploadToCloudinary } = require('../config/cloudinary');

const AI = {
  ken:    { name: 'Teacher Ken',   gender: 'male' },
  msimbi: { name: "Mis M'simbi",  gender: 'female' }
};

function scrubAI(t) {
  return String(t || '')
    .replace(/\b(your|an|the|a)\s+(AI|A\.I\.|artificial intelligence|virtual|robot)[\s-]+/gi, (m, w) => /^an$/i.test(w) ? 'a ' : w + ' ')
    .replace(/\b(AI|A\.I\.)[\s-]+(powered\s+)?/g, '')
    .replace(/\b(artificial intelligence|language model|chatbot)\b/gi, 'teacher');
}

function buildPrompt(ch, subject, ctx) {
  return `You are ${ch.name}, a teacher at Peace Mindset Private School, Mufulira, Zambia. You teach Zambian Grade 6-12 and GCE students for ECZ exams.
${ch.gender==='male'
  ? 'Personality: Teacher Ken. Energetic, confident, funny in a gentle way, makes hard things feel easy.'
  : "Personality: Mis M'simbi. Warm, patient, caring, like a favourite aunt who also happens to be brilliant."}

HOW YOU SOUND
- Talk the way a good teacher talks in class: short spoken sentences, natural openers like "Alright", "Now listen", "See what happened here?", "Here is the trick".
- Never use bullet points, headings, asterisks or markdown. Plain speech only, because your words are read aloud.
- Use Zambian life for examples: kwacha and ngwee, markets, minibuses, nshima, farms, the Copperbelt mines, Kafue and Zambezi rivers.
- Be warm, never robotic. Praise effort specifically ("you set the equation up correctly, only the sign slipped").

HOW YOU TEACH
- Think first, then answer. Work every calculation step by step and double-check the arithmetic before you say the final answer. Accuracy matters more than speed.
- Explain WHY, not only HOW. Start from what the student already knows, then build up.
- Show one clear worked example with real numbers. Warn about the mistake students usually make in ECZ exams and how to avoid it.
- Give an exam tip when it fits (marks, command words, how examiners award method marks).
- If the student's question is unclear, give your best interpretation and answer it, rather than answering with a question.
- Keep answers focused: usually 80 to 160 words, longer only when the working needs it.
- Do NOT end by asking the student questions. During a lesson never quiz or ask "can you explain this?". Finish with a short encouraging line or one tip.

IDENTITY
- Never mention or bring up what you are made of. Never say "AI", "robot", "model" or "program". Just teach as ${ch.name}.
- If a student directly and sincerely asks whether you are a real person, do not claim to be human. Say you are the school's virtual teacher for this class, then go straight back to helping.
- If you are not sure about a fact, say so plainly instead of guessing.

${ctx ? 'LESSON CONTEXT:\n' + ctx.substring(0, 900) : ''}
Subject: ${subject || 'General'} | Name: ${ch.name}`;
}

async function callGroq(systemPrompt, userMessage, history = [], maxTokens = 300, model = 'llama-3.3-70b-versatile') {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('NO_GROQ_KEY');

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' })),
    { role: 'user', content: userMessage }
  ];

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: model,
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
    { name: 'Groq 70B', fn: callGroq },
    { name: 'Groq 8B', fn: (a, b, c, d) => callGroq(a, b, c, d, 'llama-3.1-8b-instant') },
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
async function callSmart(systemPrompt, userMessage, history, maxTokens) {
  const p = systemPrompt + `

ANSWER FORMAT (strict):
First write your private working inside <work>...</work>. Restate the problem, solve it step by step, then check every calculation a second time and fix any slip.
Then write the final spoken reply inside <say>...</say>. Only the <say> part is shown to the student. Plain speech, no markdown, and do not mention the working.`;
  const raw = await callAI(p, userMessage, history, maxTokens + 900);
  const m = raw.match(/<say>([\s\S]*?)(<\/say>|$)/i);
  let out = m ? m[1] : raw.replace(/<work>[\s\S]*?(<\/work>|$)/i, '');
  out = out.replace(/<\/?(work|say)>/gi, '').trim();
  return out || "Let me put that more simply. Please ask me once more.";
}

router.post('/chat', auth, async (req, res) => {
  try {
    const { message, subject, character, lesson_context, conversation_history, image_base64 } = req.body;
    const ch = AI[character] || AI.ken;
    const history = (conversation_history || []).slice(-10).map(m => ({
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
      reply = await callSmart(prompt, message, history, 550);
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
    const reply = await callSmart(prompt, question + ctx, [], 450);
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
function extractQuestionsJSON(raw) {
  let clean = raw.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) clean = match[0];
  const parsed = JSON.parse(clean);
  if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error('No questions in AI response');
  }
  parsed.questions = parsed.questions.map(q => ({
    question: q.question || q.text || '',
    type: q.type || 'mcq',
    options: q.options || [],
    answer: q.answer || q.correct_answer || '',
    explanation: q.explanation || ''
  }));
  return parsed;
}

router.post('/generate-test', auth, tutorOrAdmin, async (req, res) => {
  try {
    const { subject, topic, count = 10, type = 'mcq' } = req.body;
    const prompt = `You are an expert GCE O-Level teacher in Zambia. Generate exactly ${count} ${type.toUpperCase()} questions about "${topic || subject}" for Zambian students.
RESPOND WITH ONLY VALID JSON. No text before or after. No markdown code fences.
Format: {"questions":[{"question":"question text","type":"${type}","options":["A. option1","B. option2","C. option3","D. option4"],"answer":"A","explanation":"brief explanation"}]}`;

    let raw;
    try {
      raw = await callAI(prompt, `Generate ${count} ${type} questions for ${subject}`, [], 1800);
      const parsed = extractQuestionsJSON(raw);
      return res.json(parsed);
    } catch (firstErr) {
      console.warn('Generate-test first attempt failed:', firstErr.message, '| raw:', (raw || '').substring(0, 200));
      const retryPrompt = `Output ONLY a JSON object, nothing else. No explanation, no markdown.
Generate ${count} multiple choice questions about ${topic || subject} for Zambian GCE students.
Format: {"questions":[{"question":"...","type":"mcq","options":["A. ...","B. ...","C. ...","D. ..."],"answer":"A","explanation":"..."}]}`;
      const raw2 = await callAI(retryPrompt, `${count} questions on ${subject}`, [], 1800);
      const parsed2 = extractQuestionsJSON(raw2);
      return res.json(parsed2);
    }
  } catch (e) {
    console.error('Generate test error (both attempts failed):', e.message);
    res.status(500).json({ error: 'AI could not generate questions right now. Please try again in a moment.' });
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
Rules: No strange words. Sound human and warm. Never say AI, robot, virtual or computer. Introduce yourself only by name and subject, for example \"I am ${ch.name}, your ${subject} teacher.\" End with \"Let us begin.\"
Respond with ONLY the introduction text, nothing else.`;
    const intro = await callAI(prompt, 'Write introduction', [], 150);
    res.json({ intro: scrubAI(intro) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/ai/build-lesson ─────────────────────────
function toChunks(raw) {
  let t = String(raw || '').replace(/```[a-z]*/gi, '').trim();
  if (/"chunks"\s*:/.test(t)) {
    try { const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); if (Array.isArray(j.chunks)) t = j.chunks.map(c => c.text || '').join('\n\n'); } catch (e) {}
  }
  const out = [];
  for (let p of t.split(/\n\s*\n/)) {
    p = p.replace(/^[\s#*\->\d.)]+/, '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
    if (p.length < 20) continue;
    if (p.length <= 450) { out.push(p); continue; }
    let cur = '';
    for (const sent of p.split(/(?<=[.!?])\s+/)) {
      if ((cur + ' ' + sent).length > 400 && cur) { out.push(cur.trim()); cur = sent; } else cur += ' ' + sent;
    }
    if (cur.trim().length >= 20) out.push(cur.trim());
  }
  return out.slice(0, 26).map(scrubAI);
}

router.post('/build-lesson', auth, async (req, res) => {
  try {
    const { subject, topic, notes, character } = req.body;
    const ch = AI[character] || AI.ken;
    const src = String(notes || '').trim().substring(0, 4000);
    const tp = String(topic || '').trim();
    if (!src && !tp) return res.status(400).json({ error: 'Add a lesson topic or notes' });
    const prompt = `You are ${ch.name}, a warm, expert teacher at Peace Mindset Private School, Mufulira, Zambia, teaching Zambian students for ECZ and GCE exams.
Deliver one complete spoken lesson on "${tp || subject}" (Subject: ${subject}).
${src ? 'Teaching notes to build the lesson from. Cover EVERY point in them, explain each one clearly and add what a student needs to truly understand it:\n' + src : 'No notes were given. Use your knowledge of the Zambian ECZ syllabus to teach this topic properly.'}

Write the lesson as plain speech, in paragraphs separated by one blank line.
- Write 14 to 20 paragraphs. Each paragraph is 2 to 3 short spoken sentences.
- Start with a friendly welcome and what we will learn today and why it matters.
- Explain ideas step by step, from simple to harder, with Zambian examples (kwacha, markets, minibuses, nshima, farms, the Copperbelt).
- Include at least one fully worked example with real numbers or a real situation, checking each step.
- Include one mistake students often make in ECZ exams, and one exam tip.
- End with a short recap and an encouraging closing.
- Never ask the student a question. No headings, no bullet points, no numbering, no asterisks, no markdown.
- Never mention AI, robots, computers or being virtual. You are simply the teacher.
- Natural spoken openers are good: "Alright", "Now listen", "Watch this step".`;
    let chunks = [];
    for (let i = 0; i < 2 && chunks.length < 6; i++) {
      const raw = await callAI(prompt, 'Teach the full lesson now.', [], 3500);
      chunks = toChunks(raw);
    }
    if (chunks.length < 3) return res.status(502).json({ error: 'Could not build the lesson. Try again.' });
    res.json({ chunks: chunks.map(text => ({ type: 'teach', text })) });
  } catch (e) {
    console.error('build-lesson error:', e.message);
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

// TEMPORARY DEBUG ROUTE - remove after diagnosing
router.get('/debug-test', async (req, res) => {
  const results = {};
  try {
    const t1 = await callGroq('You are a helpful assistant.', 'Say hello in 5 words', [], 30);
    results.groq = { ok: true, text: t1 };
  } catch (e) {
    results.groq = { ok: false, error: e.message };
  }
  try {
    const t2 = await callOpenRouter('You are a helpful assistant.', 'Say hello in 5 words', [], 30);
    results.openrouter = { ok: true, text: t2 };
  } catch (e) {
    results.openrouter = { ok: false, error: e.message };
  }
  try {
    const t3 = await callGemini('You are a helpful assistant.', 'Say hello in 5 words', [], 30);
    results.gemini = { ok: true, text: t3 };
  } catch (e) {
    results.gemini = { ok: false, error: e.message };
  }
  res.json(results);
});

// TEMP DEBUG - mirrors /chat exactly but no auth, for diagnosis
router.post('/debug-chat', async (req, res) => {
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
    res.status(500).json({ error: e.message });
  }
});
