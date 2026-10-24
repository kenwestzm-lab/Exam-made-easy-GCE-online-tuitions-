const mongoose = require('mongoose');
const { LiveClass } = require('../models');
const { studentHasAccess } = require('./access');

const Board = mongoose.models.ClassBoard || mongoose.model('ClassBoard', new mongoose.Schema({ class_id: { type: mongoose.Schema.Types.ObjectId, unique: true, index: true }, data: mongoose.Schema.Types.Mixed }, { timestamps: true }));
const boards = new Map();
const RN = id => 'board_' + id;
const KINDS = new Set(['s', 'l', 'a', 'r', 'e', 't', 'i']);
const num = v => (Number.isFinite(+v) ? +v : 0);
const MAX_NUMS = 400000;

async function stateFor(id) {
  let b = boards.get(id); if (b) return b;
  const doc = await Board.findOne({ class_id: id }).lean();
  b = (doc && doc.data && Array.isArray(doc.data.pages) && doc.data.pages.length) ? { pages: doc.data.pages, cur: doc.data.cur || 0 } : { pages: [{ id: 'p1', bg: null, items: [] }], cur: 0 };
  b.n = b.pages.reduce((a, p) => a + p.items.reduce((s, i) => s + (i.p ? i.p.length : 0), 0), 0);
  b.dirty = false; b.touched = Date.now(); boards.set(id, b); return b;
}
function save(id) { const b = boards.get(id); if (!b || !b.dirty) return; b.dirty = false; Board.updateOne({ class_id: id }, { data: { pages: b.pages, cur: b.cur } }, { upsert: true }).catch(e => console.error('board save:', e.message)); }
function mark(id, b) { b.dirty = true; clearTimeout(b.timer); b.timer = setTimeout(() => save(id), 2500); }
const recount = b => { b.n = b.pages.reduce((a, p) => a + p.items.reduce((s, i) => s + (i.p ? i.p.length : 0), 0), 0); };
const okUrl = u => typeof u === 'string' && /^https:\/\/\S+$/i.test(u) && u.length < 600;

function cleanItem(it) {
  if (!it || typeof it !== 'object' || typeof it.id !== 'string' || it.id.length > 40 || !KINDS.has(it.k)) return null;
  const o = { id: it.id, k: it.k, c: String(it.c || '#111827').slice(0, 9), w: Math.min(80, Math.max(1, num(it.w) || 4)) };
  if (it.k === 's') { o.hl = !!it.hl; o.p = (Array.isArray(it.p) ? it.p : []).slice(0, 8000).map(num); if (o.p.length < 2) return null; }
  else if (it.k === 't') { o.x = num(it.x); o.y = num(it.y); o.z = Math.min(160, Math.max(12, num(it.z) || 34)); o.s = String(it.s || '').slice(0, 2000); }
  else if (it.k === 'i') { if (!okUrl(it.u)) return null; o.u = it.u; o.x = num(it.x); o.y = num(it.y); o.w = Math.max(10, num(it.w)); o.h = Math.max(10, num(it.h)); }
  else { o.x1 = num(it.x1); o.y1 = num(it.y1); o.x2 = num(it.x2); o.y2 = num(it.y2); }
  return o;
}
function applyOp(b, op) {
  if (!op || typeof op !== 'object') return false;
  const P = b.pages, p = P[op.page | 0];
  switch (op.t) {
    case 'add': { const it = cleanItem(op.item); if (!p || !it || p.items.length >= 800 || b.n > MAX_NUMS) return false; p.items.push(it); b.n += it.p ? it.p.length : 0; return true; }
    case 'pts': { const it = p && p.items.find(i => i.id === op.id); if (!it || it.k !== 's' || !Array.isArray(op.pts) || it.p.length > 8000 || b.n > MAX_NUMS) return false; const add = op.pts.slice(0, 400).map(num); it.p.push(...add); b.n += add.length; return true; }
    case 'upd': { const it = p && p.items.find(i => i.id === op.id); if (!it || !op.patch) return false; for (const k of ['x', 'y', 'w', 'h', 'z']) if (op.patch[k] !== undefined) it[k] = num(op.patch[k]); return true; }
    case 'del': { if (!p) return false; p.items = p.items.filter(i => i.id !== op.id); recount(b); return true; }
    case 'clear': { if (!p) return false; p.items = []; recount(b); return true; }
    case 'bg': { if (!p || !okUrl(op.url)) return false; p.bg = op.url; return true; }
    case 'pageAdd': { if (P.length >= 40) return false; P.splice(Math.max(0, Math.min(P.length, op.at | 0)), 0, { id: String(op.id || 'p' + Date.now()).slice(0, 40), bg: okUrl(op.bg) ? op.bg : null, items: [] }); return true; }
    case 'pageDel': { if (!p) return false; P.splice(op.page | 0, 1); if (!P.length) P.push({ id: 'p' + Date.now(), bg: null, items: [] }); b.cur = Math.min(b.cur, P.length - 1); recount(b); return true; }
    case 'cur': { b.cur = Math.max(0, Math.min(P.length - 1, op.cur | 0)); return true; }
  }
  return false;
}

function register(io, socket) {
  const me = socket.data.user;
  if (!me) return;
  socket.on('bd_join', async (d, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const id = d && d.classId;
      if (!mongoose.isValidObjectId(id)) return reply({ error: 'Invalid class' });
      const cls = await LiveClass.findById(id).select('tutor_id subject_id presenter_type delivery');
      if (!cls || cls.presenter_type === 'ai') return reply({ error: 'This class has no board' });
      const owner = me.role === 'admin' || (me.role === 'tutor' && String(cls.tutor_id) === me._id);
      const ok = owner || (me.role === 'tutor' ? !!me.approved : (me.role === 'student' && !!cls.tutor_id && await studentHasAccess(me._id, cls.tutor_id, cls.subject_id)));
      if (!ok) return reply({ error: 'Locked. Subscribe to this tutor to join.' });
      const key = String(cls._id), b = await stateFor(key);
      b.touched = Date.now();
      if (socket.data.board && socket.data.board !== key) socket.leave(RN(socket.data.board));
      socket.join(RN(key)); socket.data.board = key; socket.data.boardHost = owner;
      reply({ ok: true, host: owner, pages: b.pages, cur: b.cur });
    } catch (e) { console.error('bd_join:', e.message); reply({ error: 'Could not open the board' }); }
  });
  socket.on('bd_op', (d) => {
    const key = socket.data.board; if (!key || !socket.data.boardHost || !d) return;
    const b = boards.get(key); if (!b || !applyOp(b, d.op)) return;
    b.touched = Date.now(); mark(key, b);
    socket.to(RN(key)).emit('bd_op', d.op);
  });
  socket.on('bd_laser', (d) => {
    const key = socket.data.board; if (!key || !socket.data.boardHost || !d) return;
    socket.to(RN(key)).emit('bd_laser', { x: num(d.x), y: num(d.y), on: !!d.on });
  });
  socket.on('disconnect', () => { if (socket.data.board) save(socket.data.board); });
}
setInterval(() => { for (const [id, b] of boards) if (!b.dirty && Date.now() - b.touched > 30 * 60000) boards.delete(id); }, 10 * 60000).unref();
module.exports = { register };
