// Logic tests on SYNTHETIC data only (isolated from demo/production content).
const assert = require('assert');
require('../js/util.js'); const S = require('../js/storage.js'), C = require('../js/core.js'), { loadContent } = require('../js/loader.js');
let pass = 0; const t = async (n, f) => { try { await f(); pass++; console.log('  ✓', n); } catch (e) { console.error('  ✗', n, '\n   ', e.message); process.exitCode = 1; } };

const mk = (nl, nq, opts = 4) => {
  const files = { 'subject.json': { id: 'syn', name: 'Syn' }, 'lectures.json': [], 'questions.json': [], 'enrichment.json': { items: {} } };
  for (let l = 1; l <= nl; l++) { files['lectures.json'].push({ id: 'L' + l, title: 'Lec ' + l }); for (let q = 1; q <= nq; q++) files['questions.json'].push({ id: `L${l}-Q${q}`, lectureId: 'L' + l, text: `q${q}`, options: Array.from({ length: opts }, (_, i) => 'o' + i), correct: q % opts }); }
  return files;
};
const load = (files) => loadContent('x/', async (u) => { const k = u.replace('x/', ''); return files[k] === undefined ? { status: 404, ok: false } : { status: 200, ok: true, json: async () => JSON.parse(JSON.stringify(files[k])) }; });
const DAY = 86400000, T0 = new Date(2026, 0, 10, 12).getTime();
const run = (st, c, s, answers, ts) => { answers.forEach((ch, i) => { const q = c.qById.get(s.qids[i]); C.recordAnswer(st, c, s, q.id, ch === 'c' ? q.correct : ch === 'w' ? (q.correct + 1) % q.options.length : ch, ts + i); }); };

(async () => {
  console.log('core');
  const c = await load(mk(3, 5));
  await t('any number of lectures/questions/options', async () => { assert.equal(c.lectures.length, 3); assert.equal(c.questions.length, 15); const c2 = await load(mk(1, 2, 7)); assert.equal(c2.questions[0].options.length, 7); });
  await t('empty / missing files give empty content, no throw', async () => { const e = await load({}); assert.equal(e.lectures.length, 0); const e2 = await load({ 'lectures.json': [] }); assert.equal(e2.questions.length, 0); });
  await t('invalid data is skipped with warnings (dup id, bad correct, orphan)', async () => {
    const f = mk(1, 2); f['questions.json'].push({ id: 'L1-Q1', lectureId: 'L1', text: 'd', options: ['a', 'b'], correct: 0 }, { id: 'bad', lectureId: 'L1', text: 'd', options: ['a', 'b'], correct: 5 }, { id: 'orph', lectureId: 'ZZ', text: 'd', options: ['a', 'b'], correct: 0 });
    const x = await load(f); assert.equal(x.questions.length, 2); assert.equal(x.warnings.length, 3);
  });

  console.log('answers / mistakes');
  const st = S.emptyState(); const s = C.newSession(c, 'lecture', 'L1', c.byLecture.get('L1').map((q) => q.id), T0, 'Lec 1'); st.sessions[s.id] = s;
  await t('no double scoring on repeated answer', () => {
    const q = s.qids[0]; assert.ok(C.recordAnswer(st, c, s, q, c.qById.get(q).correct, T0).ok);
    assert.equal(C.recordAnswer(st, c, s, q, 0, T0).reason, 'duplicate'); assert.equal(st.runs.correct, 1); assert.equal(Object.keys(s.answers).length, 1);
  });
  await t('wrong answer -> active mistake; later correct -> resolved, wrongCount kept', () => {
    const q = c.qById.get(s.qids[1]); C.recordAnswer(st, c, s, q.id, (q.correct + 1) % 4, T0 + 5); assert.equal(st.mistakes[q.id].status, 'active'); assert.equal(st.runs.correct, 0);
    const s2 = C.newSession(c, 'mistakes', null, [q.id], T0 + 9, 'M'); st.sessions[s2.id] = s2; C.recordAnswer(st, c, s2, q.id, q.correct, T0 + 10);
    assert.equal(st.mistakes[q.id].status, 'resolved'); assert.equal(st.mistakes[q.id].wrongCount, 1); assert.deepEqual(C.activeMistakeIds(st, c), []);
  });
  await t('invalid choice / question outside session rejected', () => { assert.equal(C.recordAnswer(st, c, s, s.qids[2], 9, T0).reason, 'range'); assert.equal(C.recordAnswer(st, c, s, 'L2-Q1', 0, T0).reason, 'notInSession'); });

  console.log('finalize / attempts');
  await t('finalize once; re-finalize does not duplicate attempt or achievements', () => {
    const ids = s.qids; ids.slice(2).forEach((id) => C.recordAnswer(st, c, s, id, c.qById.get(id).correct, T0 + 20));
    const r1 = C.finalizeSession(st, c, s, T0 + 100); const r2 = C.finalizeSession(st, c, s, T0 + 200);
    assert.equal(st.attempts.length, 1); assert.ok(r2.duplicate); assert.equal(r1.attempt.total, 5); assert.equal(r1.attempt.correct, 4); assert.equal(r1.attempt.pct, 80); assert.ok(r1.attempt.full); assert.equal(r2.newAchievements.length, 0);
  });
  await t('mastery uses LAST answer; coverage counts distinct questions', () => {
    const ls = C.lectureStats(st, c, 'L1'); assert.equal(ls.total, 5); assert.equal(ls.answered, 5); assert.equal(ls.coveragePct, 100); assert.equal(ls.correct, 5); assert.equal(ls.masteryPct, 100);
    assert.equal(C.lectureStats(st, c, 'L2').coveragePct, 0);
    const q = c.qById.get('L1-Q1'); const s3 = C.newSession(c, 'custom', null, [q.id], T0 + 300, 'x'); st.sessions[s3.id] = s3; C.recordAnswer(st, c, s3, q.id, (q.correct + 1) % 4, T0 + 301);
    const l2 = C.lectureStats(st, c, 'L1'); assert.equal(l2.coveragePct, 100); assert.equal(l2.correct, 4); assert.equal(l2.masteryPct, 80);
  });

  console.log('comparison');
  await t('compare only full lecture attempts of same lecture; custom & partial excluded', () => {
    const s4 = C.newSession(c, 'lecture', 'L1', c.byLecture.get('L1').map((q) => q.id), T0 + 1000, 'Lec 1'); st.sessions[s4.id] = s4; run(st, c, s4, ['c', 'c', 'c', 'c', 'c'], T0 + 1000); s4.elapsedMs = 30000;
    const r = C.finalizeSession(st, c, s4, T0 + 2000); const cmp = C.compareFull(st, 'L1');
    assert.equal(cmp.count, 2); assert.equal(cmp.dPct, 20); assert.equal(cmp.dWrong, -1); assert.equal(cmp.verdict, 'improved');
    const part = C.newSession(c, 'lecture', 'L1', ['L1-Q1', 'L1-Q2'], T0 + 3000, 'p'); assert.equal(part.fullSet, false); st.sessions[part.id] = part; run(st, c, part, ['c', 'c'], T0 + 3000); C.finalizeSession(st, c, part, T0 + 3100);
    const cu = C.newSession(c, 'favorites', null, c.byLecture.get('L1').map((q) => q.id), T0 + 3200, 'f'); st.sessions[cu.id] = cu; run(st, c, cu, ['c', 'c', 'c', 'c', 'c'], T0 + 3200); C.finalizeSession(st, c, cu, T0 + 3300);
    assert.equal(C.compareFull(st, 'L1').count, 2); assert.equal(C.compareFull(st, 'L2').count, 0);
  });

  console.log('streaks / achievements');
  await t('day streak current/best, gap resets current', () => {
    const x = S.emptyState(); [0, 1, 2, 4].forEach((d) => C.addActivity(x, T0 + d * DAY));
    assert.equal(C.streaks(x, T0 + 4 * DAY).current, 1); assert.equal(C.streaks(x, T0 + 4 * DAY).best, 3); assert.equal(C.streaks(x, T0 + 6 * DAY).current, 0);
    const y = S.emptyState(); [0, 1, 2].forEach((d) => C.addActivity(y, T0 + d * DAY)); assert.equal(C.streaks(y, T0 + 3 * DAY).current, 3);
  });
  await t('100 distinct questions, 10 attempts, 100-run, perfect, 7-day streak: granted once', async () => {
    const big = await load(mk(1, 120)); const x = S.emptyState(); let granted = [];
    const sess = C.newSession(big, 'lecture', 'L1', big.questions.map((q) => q.id), T0, 'Big'); x.sessions[sess.id] = sess;
    big.questions.forEach((q, i) => { granted.push(...C.recordAnswer(x, big, sess, q.id, q.correct, T0 + i).newAchievements.map((a) => a.id)); });
    assert.ok(granted.includes('distinct100') && granted.includes('run100')); assert.equal(x.runs.best, 120);
    const fin = C.finalizeSession(x, big, sess, T0 + 500); assert.ok(fin.newAchievements.some((a) => a.id === 'perfect'));
    for (let i = 0; i < 9; i++) { const q = big.questions[i], s5 = C.newSession(big, 'custom', null, [q.id], T0 + 600 + i, 'c'); x.sessions[s5.id] = s5; C.recordAnswer(x, big, s5, q.id, q.correct, T0 + 600 + i); granted.push(...C.finalizeSession(x, big, s5, T0 + 700 + i).newAchievements.map((a) => a.id)); }
    assert.ok(granted.includes('attempts10'));
    for (let d = 1; d < 7; d++) C.addActivity(x, T0 + d * DAY); assert.ok(C.evaluateAchievements(x, T0 + 7 * DAY).some((a) => a.id === 'consistency7'));
    assert.equal(C.evaluateAchievements(x, T0 + 8 * DAY).length, 0); assert.equal(new Set(granted).size, granted.length);
  });

  console.log('content changes');
  await t('removed questions: history kept, sessions pruned, active stats ignore them', async () => {
    const x = S.emptyState(); const a = C.newSession(c, 'lecture', 'L1', c.byLecture.get('L1').map((q) => q.id), T0, 'Lec 1'); x.sessions[a.id] = a; run(x, c, a, ['w', 'c'], T0);
    const done = C.newSession(c, 'lecture', 'L2', c.byLecture.get('L2').map((q) => q.id), T0, 'Lec 2'); x.sessions[done.id] = done; run(x, c, done, ['w', 'c', 'c', 'c', 'c'], T0); C.finalizeSession(x, c, done, T0 + 9);
    const f = mk(1, 5); f['questions.json'] = f['questions.json'].filter((q) => q.id !== 'L1-Q1'); const c2 = await load(f);
    C.reconcile(x, c2); assert.equal(x.sessions[a.id].qids.length, 4); assert.ok(!x.sessions[a.id].answers['L1-Q1']);
    assert.equal(x.attempts.length, 1); assert.equal(x.attempts[0].items.length, 5); assert.ok(x.mistakes['L1-Q1'] && x.mistakes['L2-Q1']);
    assert.deepEqual(C.activeMistakeIds(x, c2), []); assert.equal(C.lectureStats(x, c2, 'L1').total, 4);
    const gone = await load({ 'subject.json': { id: 'syn' }, 'lectures.json': [], 'questions.json': [] }); C.reconcile(x, gone); assert.equal(Object.keys(x.sessions).length, 0); assert.equal(x.attempts.length, 1);
  });

  console.log('storage');
  const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, removeItem: (k) => delete m[k], _m: m }; };
  await t('namespaces isolate subjects and repos; demo isolated', () => {
    const b = mem(), k1 = S.storageKey('u.github.io/a', 'math'), k2 = S.storageKey('u.github.io/b', 'math'), k3 = S.storageKey('u.github.io/a', 'math', true);
    assert.equal(new Set([k1, k2, k3]).size, 3); const s1 = S.createStore(k1, b); s1.state.favorites.x = 1; s1.save(); assert.deepEqual(S.createStore(k2, b).state.favorites, {}); assert.equal(S.createStore(k1, b).state.favorites.x, 1);
  });
  await t('corrupt data is backed up, newer schema is read-only, quota error reported', () => {
    const b = mem(); b.setItem('k', '{bad'); const s1 = S.createStore('k', b); assert.ok(s1.recovered); assert.ok(Object.keys(b._m).some((k) => k.startsWith('k.corrupt.')));
    b.setItem('n', JSON.stringify({ schema: 99, state: { favorites: { a: 1 } } })); const s2 = S.createStore('n', b); assert.ok(s2.readOnly); assert.equal(s2.save(), false); assert.equal(JSON.parse(b._m.n).schema, 99);
    const q = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem() {} }; const s3 = S.createStore('q', q); assert.equal(s3.save(), false); assert.ok(s3.lastError);
  });
  await t('missing keys in old saved state get defaults', () => { const b = mem(); b.setItem('o', JSON.stringify({ schema: 1, state: { favorites: { z: 1 } } })); const s1 = S.createStore('o', b); assert.equal(s1.state.favorites.z, 1); assert.deepEqual(s1.state.attempts, []); assert.equal(s1.state.settings.translate, 'off'); });
  console.log(`\n${pass} passed`);
})();
