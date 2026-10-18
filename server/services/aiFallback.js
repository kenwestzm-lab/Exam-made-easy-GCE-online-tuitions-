const orig = require('../routes/ai_tutor');
const CANNED = /ask again in a moment/i;
const cache = {};
async function post(url, key, body, ms = 30000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal: ctl.signal });
    const txt = await r.text();
    if (!r.ok) throw new Error(r.status + ' ' + txt.slice(0, 160));
    return JSON.parse(txt);
  } finally { clearTimeout(t); }
}
async function pickModel(name, base, key, prefs) {
  if (cache[name]) return cache[name];
  const r = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + key } });
  const ids = ((await r.json()).data || []).map(m => m.id);
  const id = prefs.map(p => ids.find(i => i.includes(p))).find(Boolean) || ids[0];
  if (!id) throw new Error('no models available');
  return (cache[name] = id);
}
const PROVIDERS = [
  { name: 'Cerebras', env: 'CEREBRAS_API_KEY', base: 'https://api.cerebras.ai/v1', prefs: ['gpt-oss-120b', 'llama-3.3-70b', 'qwen', 'llama'] },
  { name: 'Mistral', env: 'MISTRAL_API_KEY', base: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' }
];
async function viaProvider(p, sys, user, history, maxTokens) {
  const key = process.env[p.env];
  const model = p.model || await pickModel(p.name, p.base, key, p.prefs);
  const messages = [{ role: 'system', content: sys }, ...history.slice(-10).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' })), { role: 'user', content: user }];
  const body = { model, messages, max_tokens: maxTokens + (/gpt-oss/.test(model) ? 1200 : 0), temperature: 0.7 };
  if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';
  const j = await post(p.base + '/chat/completions', key, body);
  const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!text || !String(text).trim()) throw new Error('empty answer');
  return String(text).trim();
}
async function callAI(sys, user, history = [], maxTokens = 400) {
  if (!process.env.AI_TEST_FALLBACK) {
    try { const out = await orig.callAI(sys, user, history, maxTokens); if (out && !CANNED.test(String(out))) return out; }
    catch (e) { console.warn('main AI chain failed:', e.message); }
  }
  for (const p of PROVIDERS) {
    if (!process.env[p.env]) continue;
    try { console.log('Trying backup AI:', p.name); const out = await viaProvider(p, sys, user, history, maxTokens); console.log('✅ backup AI answered:', p.name); return out; }
    catch (e) { console.warn('❌ backup AI failed:', p.name, e.message); }
  }
  throw new Error('All AI providers are busy');
}
module.exports = { callAI };
