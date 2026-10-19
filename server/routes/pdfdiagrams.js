const express = require('express');
const router = express.Router();
const { auth, tutorOrAdmin } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../config/cloudinary');
const ai = require('./ai_tutor');
const { PDFParse } = require('pdf-parse');

router.post('/diagrams', auth, tutorOrAdmin, upload.single('file'), async (req, res) => {
  let parser;
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!/\.pdf$/i.test(req.file.originalname)) return res.json({ diagrams: [] });
    parser = new PDFParse({ data: new Uint8Array(req.file.buffer) });
    let total = 30;
    try { const info = await parser.getInfo(); if (info && info.total) total = info.total; } catch (e) {}
    const pages = Array.from({ length: Math.min(total, 30) }, (_, i) => i + 1);
    const r = await parser.getImage({ partial: pages });
    const seen = new Set(); let found = [];
    for (const pg of r.pages || []) for (const im of pg.images || []) {
      const w = im.width || 0, h = im.height || 0;
      if (w < 150 || h < 150 || w / h > 6 || h / w > 6) continue;
      const key = w + 'x' + h + ':' + (im.data ? im.data.length : 0);
      if (seen.has(key)) continue; seen.add(key);
      found.push({ page: pg.pageNumber, area: w * h, data: im.data });
    }
    found = found.sort((a, b) => b.area - a.area).slice(0, 8).sort((a, b) => a.page - b.page);
    const diagrams = [];
    for (const f of found) {
      try {
        const buf = Buffer.from(f.data);
        const up = await uploadToCloudinary(buf, 'peace-mindset/pdf-diagrams', 'image');
        let caption = '';
        if (ai.callGeminiVision) {
          try { caption = String(await ai.callGeminiVision('In under 12 words, say what this diagram or figure shows. Name the subject only.', buf.toString('base64'), 'image/png')).trim().slice(0, 120); } catch (e) {}
        }
        diagrams.push({ url: up.secure_url, caption, page: f.page });
      } catch (e) { console.warn('pdf diagram upload failed:', e.message); }
    }
    const tables = [];
    try {
      const tp = new PDFParse({ data: new Uint8Array(req.file.buffer) });
      const tr = await tp.getTable({ partial: pages });
      for (const pg of tr.pages || []) for (const t of pg.tables || []) {
        const grid = Array.isArray(t) ? t : ((t && t.rows) || []);
        const rows = grid.map(r => (r || []).map(c => String(c == null ? '' : c).replace(/\s+/g, ' ').trim().slice(0, 40)).slice(0, 8)).filter(r => r.some(c => c)).slice(0, 12);
        if (rows.length >= 2 && Math.max(...rows.map(r => r.length)) >= 2) tables.push({ page: pg.num || pg.pageNumber || 0, rows });
      }
      await tp.destroy();
    } catch (e) { console.warn('pdf tables:', e.message); }
    res.json({ diagrams, tables: tables.slice(0, 6) });
  } catch (e) {
    console.error('pdf diagrams error:', e.message);
    res.status(500).json({ error: 'Could not read diagrams from this PDF' });
  } finally { try { if (parser) await parser.destroy(); } catch (e) {} }
});

module.exports = router;
