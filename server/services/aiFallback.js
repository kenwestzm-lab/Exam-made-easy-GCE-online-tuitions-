const orig = require('../routes/ai_tutor');
const CANNED = /ask again in a moment/i;
const cache = {};
async function post(url, key, body, ms = 35000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, 'X-Title': 'Ken Exam Made Easy' }, body: JSON.stringify(body), signal: ctl.signal });
    const txt = await r.text();
    if (!r.ok) throw new Error(r.status + ' ' + txt.slice(0, 160));
    return JSON.parse(txt);
  } finally { clearTimeout(t); }
}
const rank = (id, prefs) => { const i = prefs.findIndex(p => id.includes(p)); return i === -1 ? 99 : i; };
async function listModels(base, key) {
  const r = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + key } });
  if (!r.ok) throw new Error('models list ' + r.status);
  return (await r.json()).data || [];
}
// OpenRouter: only models that are free right now, best first
async function openrouterModels(key) {
  if (cache.or && Date.now() - cache.or.at < 3600000) return cache.or.ids;
  const list = await listModels('https://openrouter.ai/api/v1', key);
  const prefs = ['gpt-oss-120b', 'llama-3.3-70b', 'qwen', 'gemma', 'mistral', 'llama'];
  const ids = list.filter(m => /:free$/.test(m.id) && m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0
      && (m.context_length || 0) >= 8000 && (((m.architecture || {}).output_modalities) || ['text']).includes('text'))
    .map(m => m.id).filter(id => /^(google|meta-llama|mistralai|qwen|openai|nvidia|deepseek)\//.test(id)).sort((a, b) => rank(a, prefs) - rank(b, prefs)).slice(0, 6);
  if (!ids.length) throw new Error('no free models listed right now');
  cache.or = { at: Date.now(), ids }; return ids;
}
const PROVIDERS = [
  { name: 'Cerebras', env: 'CEREBRAS_API_KEY', base: 'https://api.cerebras.ai/v1', models: async k => { const l = await listModels('https://api.cerebras.ai/v1', k); const p = ['gpt-oss-120b', 'llama-3.3-70b', 'qwen', 'llama']; return l.map(m => m.id).sort((a, b) => rank(a, p) - rank(b, p)).slice(0, 2); } },
  { name: 'OpenRouter', env: 'OPENROUTER_API_KEY', base: 'https://openrouter.ai/api/v1', models: openrouterModels },
  { name: 'Mistral', env: 'MISTRAL_API_KEY', base: 'https://api.mistral.ai/v1', models: async () => ['mistral-small-latest'] }
];
async function tryModel(p, model, sys, user, history, maxTokens) {
  const key = process.env[p.env], gptoss = /gpt-oss/.test(model);
  const messages = [{ role: 'system', content: sys }, ...history.slice(-10).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' })), { role: 'user', content: user }];
  const body = { model, messages, max_tokens: maxTokens + (gptoss ? 1200 : (p.name === 'OpenRouter' ? 600 : 0)), temperature: 0.7 };
  if (gptoss) { if (p.name === 'OpenRouter') body.reasoning = { effort: 'low' }; else body.reasoning_effort = 'low'; }
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
    if (process.env.AI_ONLY && p.name.toLowerCase() !== process.env.AI_ONLY.toLowerCase()) continue;
    let models = [];
    try { models = await p.models(process.env[p.env]); } catch (e) { console.warn('❌ backup AI failed:', p.name, e.message); continue; }
    for (const m of models) {
      try { console.log('Trying backup AI:', p.name, m); const out = await tryModel(p, m, sys, user, history, maxTokens); console.log('✅ backup AI answered:', p.name, m); return out; }
      catch (e) { console.warn('❌ backup AI failed:', p.name, m, e.message); }
    }
  }
  throw new Error('All AI providers are busy');
}
module.exports = { callAI };
