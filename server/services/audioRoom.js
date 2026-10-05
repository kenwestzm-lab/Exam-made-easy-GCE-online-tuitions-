const mongoose = require('mongoose');
const { LiveClass } = require('../models');
const { studentHasAccess, tutorFeeExpiry } = require('./access');

const rooms = new Map();
const MAX_PEOPLE = 60, MAX_SPEAKERS = 4;
const RN = (id) => 'audio_' + id;
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

const iceServers = () => {
  try { const v = JSON.parse(process.env.ICE_SERVERS || ''); if (Array.isArray(v) && v.length) return v; } catch (e) {}
  return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
};
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const providers = {
  metered: async () => {
    const dom = process.env.METERED_DOMAIN, key = process.env.METERED_API_KEY;
    if (!dom || !key) return [];
    const r = await fetch('https://' + dom + '/api/v1/turn/credentials?apiKey=' + encodeURIComponent(key));
    const v = await r.json();
    return Array.isArray(v) ? v : [];
  },
  cloudflare: async () => {
    const id = process.env.CF_TURN_KEY_ID, tok = process.env.CF_TURN_API_TOKEN;
    if (!id || !tok) return [];
    const r = await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/' + id + '/credentials/generate', {
      method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 })
    });
    const v = await r.json();
    return v && v.iceServers ? [].concat(v.iceServers) : [];
  },
};
let iceCache = { t: 0, v: null };
const getIce = async () => {
  if (iceCache.v && Date.now() - iceCache.t < 10 * 60 * 1000) return iceCache.v;
  const names = Object.keys(providers);
  const res = await Promise.all(names.map(n => withTimeout(providers[n](), 4000).catch(e => { console.error('ICE provider ' + n + ' failed:', e.message); return []; })));
  const ok = names.filter((n, i) => res[i].length);
  console.log('ICE providers working:', ok.join(', ') || 'none');
  const merged = [].concat(...res, iceServers());
  if (ok.length) iceCache = { t: Date.now(), v: merged };
  else if (iceCache.v) return iceCache.v;
  return merged;
};
const rosterOf = (room) => [...room.peers.values()].map(p => ({ sid: p.sid, userId: p.userId, name: p.name, isHost: p.isHost, hand: p.hand, speaker: p.speaker }));
const pushRoster = (io, room) => io.to(RN(room.id)).emit('audio_roster', { roster: rosterOf(room), hostPresent: !!room.hostSid, startedAt: room.startedAt, now: Date.now() });

function removePeer(io, room, sid) {
  if (!room.peers.get(sid)) return;
  room.peers.delete(sid);
  if (room.hostSid === sid) { room.hostSid = null; io.to(RN(room.id)).emit('audio_host_left'); }
  else if (room.hostSid) io.to(room.hostSid).emit('audio_peer_left', { sid });
  pushRoster(io, room);
  if (!room.peers.size) setTimeout(() => { if (rooms.get(room.id) === room && !room.peers.size) rooms.delete(room.id); }, 5 * 60 * 1000);
}

function evictUser(io, userId, classIds) {
  for (const id of classIds) {
    const room = rooms.get(id); if (!room) continue;
    for (const p of [...room.peers.values()]) {
      if (p.userId !== userId || p.isHost) continue;
      io.to(p.sid).emit('audio_kicked', { reason: 'Your subscription to this tutor has expired.' });
      const s = io.sockets.sockets.get(p.sid); if (s) { s.leave(RN(id)); s.data.audio = null; }
      removePeer(io, room, p.sid);
    }
  }
}

function register(io, socket) {
  const me = socket.data.user;
  if (!me) return;
  const current = () => (socket.data.audio ? rooms.get(socket.data.audio) : null);
  const hostRoom = () => { const r = current(); return r && r.hostSid === socket.id ? r : null; };
  const leave = () => {
    const room = current(); if (!room) return;
    socket.leave(RN(room.id)); socket.data.audio = null; removePeer(io, room, socket.id);
  };

  socket.on('audio_join', async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const classId = payload && payload.classId;
      if (!mongoose.isValidObjectId(classId)) return reply({ error: 'Invalid class' });
      const cls = await LiveClass.findById(classId);
      if (!cls) return reply({ error: 'Class not found' });
      if (cls.delivery !== 'audio') return reply({ error: 'This is not an audio class' });
      if (cls.status === 'ended') return reply({ error: 'This class has ended', code: 'ENDED' });
      const owner = me.role === 'admin' || (me.role === 'tutor' && String(cls.tutor_id) === me._id);
      let ok = owner;
      if (!ok) {
        if (me.role === 'tutor') ok = !!me.approved;
        else if (me.role === 'student') ok = !!cls.tutor_id && await studentHasAccess(me._id, cls.tutor_id, cls.subject_id);
      }
      if (!ok) return reply({ error: 'Locked. Subscribe to this tutor to join.', code: 'LOCKED' });
      if (owner && me.role === 'tutor' && !(await tutorFeeExpiry(me._id)))
        return reply({ error: 'Your K20 monthly fee is unpaid. Pay it on the Membership tab to start classes.', code: 'TUTOR_FEE_REQUIRED' });

      leave();
      const id = String(cls._id);
      let room = rooms.get(id);
      if (!room) { room = { id, hostSid: null, hostUserId: null, peers: new Map(), note: '', chat: [], startedAt: null }; rooms.set(id, room); }
      if (room.peers.size >= MAX_PEOPLE) return reply({ error: 'This class is full' });

      let asHost = false;
      if (owner) {
        if (!room.hostSid) asHost = true;
        else if (room.hostUserId === me._id) {
          const old = room.hostSid;
          io.to(old).emit('audio_kicked', { reason: 'You opened this class on another device.' });
          const os = io.sockets.sockets.get(old); if (os) { os.leave(RN(id)); os.data.audio = null; }
          removePeer(io, room, old);
          asHost = true;
        }
      }
      room.peers.set(socket.id, { sid: socket.id, userId: me._id, name: me.name, isHost: asHost, hand: false, speaker: false });
      socket.join(RN(id)); socket.data.audio = id;
      if (asHost) {
        room.hostSid = socket.id; room.hostUserId = me._id;
        if (!room.startedAt) room.startedAt = Date.now();
        if (cls.status !== 'live') {
          await LiveClass.updateOne({ _id: cls._id }, { status: 'live' });
          io.emit('class_went_live', { _id: cls._id, title: cls.title, subject_id: cls.subject_id, tutor_id: cls.tutor_id });
        }
      }
      if (!socket.connected) { leave(); return; }
      const ice = await getIce();
      reply({ ok: true, isHost: asHost, sid: socket.id, ice, hasTurn: ice.some(s => JSON.stringify(s.urls).includes('turn')), note: room.note, chat: room.chat.slice(-50), title: cls.title });
      pushRoster(io, room);
      if (asHost) socket.emit('audio_connect_to', { sids: [...room.peers.values()].filter(p => !p.isHost).map(p => p.sid) });
      else if (room.hostSid) io.to(room.hostSid).emit('audio_connect_to', { sids: [socket.id] });
    } catch (e) { console.error('audio_join error:', e.message); reply({ error: 'Could not join the class' }); }
  });

  // Star topology: every audio link is host <-> member
  socket.on('audio_signal', (d) => {
    const room = current(); if (!room || !d || !d.to || !d.data) return;
    const self = room.peers.get(socket.id), target = room.peers.get(d.to);
    if (!self || !target || !(self.isHost || target.isHost)) return;
    if (JSON.stringify(d.data).length > 30000) return;
    io.to(d.to).emit('audio_signal', { from: socket.id, data: d.data });
  });

  socket.on('audio_hand', (d) => {
    const room = current(); const p = room && room.peers.get(socket.id);
    if (!p || p.isHost) return;
    p.hand = !!(d && d.raised); pushRoster(io, room);
  });

  socket.on('audio_grant', (d) => {
    const room = hostRoom(); const p = room && d && room.peers.get(d.sid);
    if (!p || p.isHost) return;
    if (d.on) {
      const n = [...room.peers.values()].filter(x => x.speaker).length;
      if (!p.speaker && n >= MAX_SPEAKERS) return socket.emit('audio_notice', { text: 'Maximum ' + MAX_SPEAKERS + ' students can speak at once.' });
      p.speaker = true; p.hand = false;
    } else p.speaker = false;
    io.to(p.sid).emit('audio_speaker', { on: p.speaker }); pushRoster(io, room);
  });

  socket.on('audio_mute_all', () => {
    const room = hostRoom(); if (!room) return;
    for (const p of room.peers.values()) if (p.speaker) { p.speaker = false; io.to(p.sid).emit('audio_speaker', { on: false }); }
    pushRoster(io, room);
  });

  socket.on('audio_kick', (d) => {
    const room = hostRoom(); const p = room && d && room.peers.get(d.sid);
    if (!p || p.isHost) return;
    io.to(p.sid).emit('audio_kicked', { reason: 'You were removed from the class by the tutor.' });
    const s = io.sockets.sockets.get(p.sid); if (s) { s.leave(RN(room.id)); s.data.audio = null; }
    removePeer(io, room, p.sid);
  });

  socket.on('audio_note', (d) => {
    const room = hostRoom(); if (!room) return;
    room.note = clip(d && d.text, 4000);
    io.to(RN(room.id)).emit('audio_note', { text: room.note });
  });

  socket.on('audio_levels', (d) => {
    const room = hostRoom(); if (!room) return;
    io.to(RN(room.id)).emit('audio_levels', { speaking: Array.isArray(d && d.speaking) ? d.speaking.slice(0, 20).map(String) : [] });
  });

  socket.on('audio_chat', (d) => {
    const room = current(); if (!room) return;
    const now = Date.now(); if (now - (socket.data.lastChat || 0) < 600) return; socket.data.lastChat = now;
    const text = clip(d && d.text, 400).trim(); if (!text) return;
    const msg = { id: now + '-' + socket.id.slice(0, 4), userId: me._id, name: me.name, host: room.hostSid === socket.id, text, t: now };
    room.chat.push(msg); if (room.chat.length > 100) room.chat.shift();
    io.to(RN(room.id)).emit('audio_chat', msg);
  });

  socket.on('audio_end', async () => {
    const room = hostRoom(); if (!room) return;
    try { await LiveClass.updateOne({ _id: room.id }, { status: 'ended' }); } catch (e) {}
    io.to(RN(room.id)).emit('audio_ended');
    for (const p of room.peers.values()) { const s = io.sockets.sockets.get(p.sid); if (s) { s.leave(RN(room.id)); s.data.audio = null; } }
    rooms.delete(room.id);
    io.emit('class_ended', { _id: room.id });
  });

  socket.on('audio_leave', leave);
  socket.on('disconnect', leave);
}

module.exports = { register, evictUser };
