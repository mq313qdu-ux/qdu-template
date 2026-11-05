#!/usr/bin/env node
// Usage: node tools/validate-data.js [dir=data]   — validates a content folder using the same loader as the site.
const fs = require('fs'), path = require('path');
require('../js/util.js'); const { loadContent } = require('../js/loader.js');
const dir = process.argv[2] || 'data';
const fetchFn = async (url) => { const p = path.resolve(url); return fs.existsSync(p) ? { status: 200, ok: true, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) } : { status: 404, ok: false }; };
loadContent(dir, fetchFn).then((c) => {
  console.log(`subject="${c.subject.name}" id="${c.subject.id}" lectures=${c.lectures.length} questions=${c.questions.length} enrichment=${c.enrichment.size}`);
  const orphanEn = [...c.enrichment.keys()].filter((k) => !c.qById.has(k)); if (orphanEn.length) console.log('enrichment for unknown question ids:', orphanEn);
  if (c.subject.name && !c.subject.id) console.log('WARNING: subject.id is empty (needed to isolate saved progress).');
  c.warnings.forEach((w) => console.log('WARN', w));
  process.exit(c.warnings.length ? 1 : 0);
}).catch((e) => { console.error('FAILED', e.kind || '', e.url || e.message); process.exit(2); });
