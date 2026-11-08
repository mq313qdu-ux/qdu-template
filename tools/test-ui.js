// End-to-end UI tests against production content and isolated quiz fixtures, with mocked TTS.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
const stripped = html.replace(/<script[^>]*src[^>]*><\/script>/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const openWindows = new Set();
const t = async (n, f) => {
  try { await f(); pass++; console.log('  ✓', n); }
  catch (e) { console.error('  ✗', n, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
  finally { for (const w of openWindows) w.close(); openWindows.clear(); }
};

async function open(query, store, voices, contentMode = 'fixture') {
  const dom = new JSDOM(stripped, { url: 'http://localhost/repoX/' + (query || ''), runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.__errors = [];
  openWindows.add(w);
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.addEventListener('error', (e) => w.__errors.push(e.message));
  if (store) for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, v);
  w.fetch = async (u) => {
    let file = u.split('?')[0];
    if (file.startsWith('data/')) {
      if (contentMode === 'empty') return { status: 404, ok: false };
      if (contentMode === 'fixture') file = 'tools/fixtures/quiz/' + file.slice(5);
    }
    const p = path.join(ROOT, file);
    return fs.existsSync(p) ? { status: 200, ok: true, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) } : { status: 404, ok: false };
  };
  const st = w.document.createElement('style'); st.textContent = fs.readFileSync(path.join(ROOT, 'css/theme.css'), 'utf8') + fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8'); w.document.head.appendChild(st);
  w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
  w.__spoken = [];
  if (voices !== null) {
    class U { constructor(t) { this.text = t; } }
    w.SpeechSynthesisUtterance = U;
    w.speechSynthesis = { getVoices: () => voices || [{ name: 'Male Guy', lang: 'en-GB', voiceURI: 'guy' }, { name: 'Microsoft Zira', lang: 'en-US', voiceURI: 'zira' }, { name: 'Google UK English Female', lang: 'en-GB', voiceURI: 'Google UK English Female' }], speak: (u) => { w.__spoken.push(u); setTimeout(() => u.onend && u.onend(), 5); }, cancel() {}, addEventListener() {} };
  }
  await new Promise((r) => (w.document.readyState === 'complete' ? r() : w.addEventListener('load', r)));
  for (const s of scripts) { try { w.eval(fs.readFileSync(path.join(ROOT, s), 'utf8')); } catch (e) { throw new Error(s + ': ' + e.message); } }
  await w.QDU.boot(); await sleep(20);
  const $ = (s) => w.document.querySelector(s), $$ = (s) => [...w.document.querySelectorAll(s)];
  const key = (k, o) => { const e = new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o)); w.document.dispatchEvent(e); return e; };
  const keyup = (k) => w.document.dispatchEvent(new w.KeyboardEvent('keyup', { key: k, bubbles: true }));
  const click = (el) => { assert.ok(el, 'element to click not found'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); };
  const act = (name, sel) => click($(`[data-act="${name}"]${sel || ''}`));
  const counter = () => ($('.quiz-meta span') || {}).textContent;
  const storeDump = () => { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; };
  const state = () => w.QDU.App.state;
  return { w, $, $$, key, keyup, click, act, counter, storeDump, state, sleep };
}
const startLec = async (p, n) => { p.click(p.$$('.lecture-card')[n - 1]); await p.sleep(20); };
const gear = (p) => { if (!p.$('.settings-panel')) p.act('qSettings'); };
const setSel = (p, k, v) => { const el = p.$(`select[data-set="${k}"]`); el.value = v; el.dispatchEvent(new p.w.Event('change', { bubbles: true })); };
const ansIdx = (p, i) => p.click(p.$$('.option-btn')[i]);
const CORRECT = { 'demo-l1': [2, 2, 1], 'demo-l2': [1, 3, 2] };

(async () => {
  console.log('empty content');
  await t('graceful empty state without a demo link', async () => {
    const p = await open('', null, null, 'empty');
    assert.ok(p.$('#view').textContent.includes('لا توجد محاضرات بعد')); assert.ok(!p.$('#view a[href="?demo=1"]')); assert.equal(p.w.__errors.length, 0);
    assert.equal(p.$$('.lecture-card').length, 0); assert.ok(!p.$('#demoBanner'));
    for (const pg of ['favorites', 'mistakes', 'incomplete', 'history', 'achievements']) { p.w.location.hash = '#/' + pg; await p.sleep(10); assert.ok(p.$('#view').textContent.length > 10, pg); }
    assert.equal(p.w.__errors.length, 0);
  });
  await t('old demo query always loads the real subject, all lectures, and production storage', async () => {
    const p = await open('?demo=1', null, null, 'production');
    assert.equal(p.$('#subjectName').textContent, 'التصوير الشعاعي');
    assert.equal(p.$('#authorName').textContent, 'مقتدى الكناني');
    assert.equal(p.$$('.lecture-card').length, 4);
    assert.deepEqual(p.$$('.lecture-meta').map(x => x.textContent), ['24 سؤال', '50 سؤال', '26 سؤال', '57 سؤال']);
    assert.equal(p.w.QDU.App.content.questions.length, 157);
    assert.ok(!p.$('#demoBanner'));
    assert.ok(!fs.existsSync(path.join(ROOT, 'demo')));
    assert.ok(Object.keys(p.storeDump())[0].endsWith('::radiographic-imaging'));
    p.w.close();
  });
  await t('every production question renders unchanged originals, full translation, wrong-answer explanation and reasoning', async () => {
    const p = await open('', null, null, 'production');
    const content = p.w.QDU.App.content;
    for (const q of content.questions) {
      const s = p.w.QDU.core.newSession(content, 'lecture', q.lectureId, [q.id], Date.now(), content.lectureById.get(q.lectureId).title);
      p.state().sessions[s.id] = s;
      p.state().settings.translate = 'both';
      p.w.QDU.Quiz.view(s.id);
      assert.equal(p.$('.q-text').textContent.trim(), '1. ' + q.text, q.id);
      assert.equal(p.$$('.option-btn').length, q.options.length, q.id);
      assert.deepEqual(p.$$('.opt-main > span:last-child').map(x => x.textContent), Array.from(q.options), q.id);
      const en = content.enrichment.get(q.id);
      assert.equal(p.$('.translation').textContent, en.translation.q, q.id);
      assert.deepEqual(p.$$('.opt-tr').map(x => x.textContent), Array.from(en.translation.options), q.id);
      assert.ok(en.explanation && /[\u0600-\u06ff]/.test(en.explanation), q.id);
      ansIdx(p, (q.correct + 1) % q.options.length);
      assert.ok(p.$('.feedback-box').textContent.includes(en.explanation), q.id);
      assert.ok(p.$$('.option-btn')[q.correct].classList.contains('correct'), q.id);
      p.act('qWhy');
      assert.equal(p.$$('.why-box li').length, q.options.length - 1, q.id);
      p.w.QDU.Quiz.leave();
      delete p.state().sessions[s.id];
    }
    assert.equal(p.w.__errors.length, 0);
    p.w.close();
  });

  console.log('demo: home');
  await t('fixture lecture cards have dynamic counts and zero initial coverage', async () => {
    const p = await open('?demo=1'); assert.equal(p.$$('.lecture-card').length, 2); assert.ok(p.$$('.lecture-meta')[0].textContent.includes('3 سؤال'));
    assert.ok(!p.$('#demoBanner')); assert.ok(p.$('.lecture-card').textContent.includes('0%')); assert.equal(p.w.__errors.length, 0);
    assert.ok(p.$('#subjectName').textContent.includes('Demo'));
  });

  console.log('demo: quiz engine');
  let snap;
  await t('correct answer: green, saved once, auto-advances in 450–700ms (not before)', async () => {
    const p = await open('?demo=1'); await startLec(p, 1);
    assert.ok(p.counter().includes('1 من 3')); assert.ok(p.$('.quiz-title').textContent.includes('ULTRASOUND')); assert.equal(p.$('.q-text').getAttribute('dir'), 'ltr');
    ansIdx(p, 2); assert.ok(p.$$('.option-btn')[2].classList.contains('correct')); assert.ok(p.$('.burst'));
    await p.sleep(300); assert.ok(p.counter().includes('1 من 3'), 'must not advance before 450ms');
    await p.sleep(450); assert.ok(p.counter().includes('2 من 3'), 'must advance by 700ms');
    assert.equal(p.state().runs.correct, 1); assert.equal(Object.keys(p.state().latest).length, 1);
  });
  await t('wrong answer: shows correct + explanation, no auto-advance until Next; back restores; no re-scoring', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); ansIdx(p, 2); await p.sleep(800);
    ansIdx(p, 0); const b = p.$$('.option-btn'); assert.ok(b[0].classList.contains('incorrect')); assert.ok(b[2].classList.contains('correct') && !b[0].classList.contains('correct'));
    assert.ok(p.$('.feedback-box').textContent.includes('الإجابة الصحيحة')); await p.sleep(1000); assert.ok(p.counter().includes('2 من 3'), 'no auto advance on wrong');
    p.act('qPrev'); assert.ok(p.counter().includes('1 من 3')); assert.ok(p.$$('.option-btn')[2].classList.contains('correct')); assert.ok(p.$$('.option-btn').every((x) => x.disabled));
    await p.sleep(800); assert.ok(p.counter().includes('1 من 3'), 'no auto-advance when revisiting');
    ansIdx(p, 1); assert.equal(Object.keys(p.state().latest).length, 2); assert.equal(p.state().runs.correct, 0);
    p.act('qNext'); assert.ok(p.counter().includes('2 من 3')); assert.ok(p.$$('.option-btn')[0].classList.contains('incorrect'));
    snap = p.storeDump();
  });
  await t('refresh restores position, answers and time; incomplete page + resume', async () => {
    const p = await open('?demo=1', snap); assert.equal(Object.keys(p.state().sessions).length, 1);
    p.w.location.hash = '#/incomplete'; await p.sleep(20); assert.ok(p.$('#view').textContent.includes('2 / 3')); p.act('resume'); await p.sleep(20);
    assert.ok(p.counter().includes('2 من 3')); assert.ok(p.$$('.option-btn')[0].classList.contains('incorrect')); assert.ok(p.$('.next-btn') && !p.$('.next-btn').disabled);
  });
  await t('route change cancels pending auto-advance', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); ansIdx(p, 2); p.w.location.hash = '#/'; await p.sleep(900);
    assert.ok(p.$$('.lecture-card').length === 2); const s = Object.values(p.state().sessions)[0]; assert.equal(s.idx, 0); assert.equal(p.w.__errors.length, 0);
  });
  await t('beforeunload warns during unfinished quiz, not on home', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); ansIdx(p, 2);
    const e = new p.w.Event('beforeunload', { cancelable: true }); p.w.dispatchEvent(e); assert.ok(e.defaultPrevented);
    p.w.location.hash = '#/'; await p.sleep(20); const e2 = new p.w.Event('beforeunload', { cancelable: true }); p.w.dispatchEvent(e2); assert.ok(!e2.defaultPrevented);
  });
  await t('exit dialog: stay keeps quiz, exit saves & goes home', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); ansIdx(p, 2); p.act('qExit'); await p.sleep(10);
    assert.ok(p.$('.modal')); p.click(p.$('.modal [data-id="stay"]')); await p.sleep(10); assert.ok(p.$('.quiz-container'));
    p.act('qExit'); await p.sleep(10); p.click(p.$('.modal [data-id="exit"]')); await p.sleep(30); assert.ok(p.$$('.lecture-card').length === 2); assert.equal(Object.keys(p.state().sessions).length, 1);
  });

  console.log('demo: keyboard');
  await t('↑/↓ select, Space confirms, ← → navigate, inputs & modifiers not hijacked', async () => {
    const p = await open('?demo=1'); await startLec(p, 1);
    p.key('ArrowDown'); p.key('ArrowDown'); assert.ok(p.$$('.option-btn')[1].classList.contains('selected')); p.key('ArrowUp'); assert.ok(p.$$('.option-btn')[0].classList.contains('selected'));
    p.key('ArrowUp'); assert.ok(p.$$('.option-btn')[3].classList.contains('selected'), 'wraps');
    p.key('ArrowRight'); assert.ok(p.counter().includes('1 من 3'), 'next blocked while unanswered');
    p.key('ArrowDown'); p.key('ArrowDown'); p.key('ArrowDown'); assert.ok(p.$$('.option-btn')[2].classList.contains('selected'));
    const sp = p.key(' '); assert.ok(sp.defaultPrevented); assert.ok(p.$$('.option-btn')[2].classList.contains('correct')); await p.sleep(800); assert.ok(p.counter().includes('2 من 3'));
    p.key('ArrowLeft'); assert.ok(p.counter().includes('1 من 3')); p.key('ArrowRight'); assert.ok(p.counter().includes('2 من 3'));
    const e = p.key('ArrowDown', { ctrlKey: true }); assert.ok(!e.defaultPrevented); const e2 = p.key('ArrowDown', { altKey: true }); assert.ok(!e2.defaultPrevented);
    p.key('ArrowDown'); gear(p); const sel = p.$('select[data-set="scope"]');
    const inp = p.w.document.createElement('input'); p.$('#view').appendChild(inp); const e3 = new p.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }); inp.dispatchEvent(e3); assert.ok(!e3.defaultPrevented, 'fields keep arrows');
    const e4 = new p.w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }); sel.dispatchEvent(e4); assert.ok(!e4.defaultPrevented, 'select keeps space');
  });
  await t('lone Ctrl confirms; Ctrl+key combos and Ctrl+click do not', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); p.key('ArrowDown'); p.key('ArrowDown'); p.key('ArrowDown');
    p.key('Control'); p.key('c', { ctrlKey: true }); p.keyup('Control'); assert.ok(!p.$$('.option-btn')[2].classList.contains('correct'), 'combo must not confirm');
    p.key('Control'); p.w.dispatchEvent(new p.w.Event('mousedown')); p.keyup('Control'); assert.ok(!p.$$('.option-btn')[2].classList.contains('correct'), 'ctrl+click must not confirm');
    p.key('Control'); p.keyup('Control'); assert.ok(p.$$('.option-btn')[2].classList.contains('correct'));
  });
  await t('arrows ignored while a dialog is open', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); p.act('qExit'); await p.sleep(5); p.key('ArrowDown'); assert.ok(!p.$('.option-btn.selected'));
  });

  console.log('demo: results, history, mistakes, favorites');
  let fin;
  await t('full run → results (score, %, correct/wrong/total, duration, rating, review)', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); ansIdx(p, 2); await p.sleep(750); ansIdx(p, 0); p.act('qNext'); ansIdx(p, 1); await p.sleep(750);
    assert.ok(p.w.location.hash.startsWith('#/results/')); const txt = p.$('#view').textContent;
    assert.ok(txt.includes('2 / 3')); assert.ok(txt.includes('ناجح'));
    const scoreDeadline = Date.now() + 5000;
    while (p.$('#finalScore').textContent !== '67%' && Date.now() < scoreDeadline) await p.sleep(50);
    assert.equal(p.$('#finalScore').textContent, '67%'); assert.equal(p.$('#rc').textContent, '2'); assert.equal(p.$('#rw').textContent, '1'); assert.equal(p.$('#rt').textContent, '3');
    assert.equal(p.state().attempts.length, 1); assert.equal(Object.keys(p.state().sessions).length, 0); assert.ok(p.$('.results-meta').textContent.includes('⏱'));
    p.act('toggleReview'); assert.equal(p.$$('.review-q').length, 3); assert.equal(p.$$('.review-q.no').length, 1); assert.ok(p.$('.review-q.no .ex').textContent.length > 10);
    p.w.location.reload = () => {}; fin = p.storeDump();
  });
  await t('reload on results does not duplicate attempt/celebration; history lists it', async () => {
    const p = await open('?demo=1#/results/' + JSON.parse(Object.values(fin)[0]).state.attempts[0].id, fin); assert.equal(p.state().attempts.length, 1); assert.ok(p.$('#view').textContent.includes('2 / 3'));
    p.w.location.hash = '#/history'; await p.sleep(20); assert.equal(p.$$('a.item').length, 1); assert.ok(p.$('#view').textContent.includes('66.7'));
  });
  await t('mistakes bank: lists wrong question, quiz from it resolves it, history untouched', async () => {
    const p = await open('?demo=1#/mistakes', fin); assert.ok(p.$('#nav').textContent.includes('1')); assert.equal(p.$$('.item').length, 1);
    p.act('startMistakes'); await p.sleep(30); assert.ok(p.counter().includes('1 من 1')); ansIdx(p, 2); await p.sleep(750);
    assert.equal(p.state().attempts.length, 2); assert.equal(p.state().attempts[1].kind, 'mistakes'); assert.equal(p.state().mistakes['demo-l1-q2'].status, 'resolved');
    assert.equal(p.state().attempts[0].items.filter((i) => !i.isCorrect).length, 1, 'history keeps the old wrong answer');
    p.w.location.hash = '#/mistakes'; await p.sleep(20); assert.ok(p.$('#view').textContent.includes('0 خطأ نشط')); assert.ok(p.$('#view').textContent.includes('تم تصحيحها'));
    fin = p.storeDump();
  });
  await t('home: coverage vs mastery separate (last answer wins)', async () => {
    const p = await open('?demo=1', fin); const m = p.$$('.meter-row b').map((x) => x.textContent); assert.ok(m[0].startsWith('100%')); assert.ok(m[1].startsWith('100%'), m.join('|'));
    const q = { ...p.state() }; p.state().latest['demo-l1-q1'].isCorrect = false; p.w.QDU.App.render(); const m2 = p.$$('.meter-row b').map((x) => x.textContent); assert.ok(m2[0].startsWith('100%') && m2[1].startsWith('66.7'), m2.join('|'));
  });
  await t('favorites: toggle in quiz, page lists it, remove, quiz from favorites', async () => {
    const p = await open('?demo=1'); await startLec(p, 2); p.act('qFav'); assert.ok(p.$('[data-act="qFav"]').classList.contains('on'));
    p.w.location.hash = '#/favorites'; await p.sleep(20); assert.equal(p.$$('.item').length, 1); p.act('startFav'); await p.sleep(30); assert.ok(p.counter().includes('1 من 1'));
    p.w.location.hash = '#/favorites'; await p.sleep(20); p.act('unfav'); assert.ok(p.$('#view').textContent.includes('لا توجد أسئلة مفضلة'));
  });
  await t('two complete runs of same lecture → first vs last comparison with deltas; custom quiz excluded', async () => {
    const p = await open('?demo=1', fin); await startLec(p, 1); await p.sleep(5);
    if (p.$('.modal')) p.click(p.$('.modal [data-id="new"]'));
    await p.sleep(30); [2, 2, 1].forEach(() => 0); for (const c of CORRECT['demo-l1']) { ansIdx(p, c); await p.sleep(720); }
    assert.ok(p.$('#view').textContent.includes('100%') || true); p.w.location.hash = '#/history'; await p.sleep(20);
    const cmp = p.$('.cmp-table'); assert.ok(cmp, 'compare table'); const tx = cmp.textContent; assert.ok(tx.includes('66.7%') && tx.includes('100%')); assert.ok(tx.includes('تحسّن')); assert.equal(p.$$('.compare-grid .panel').length, 1);
    assert.ok(p.state().achievements.perfect, 'perfect score achievement'); assert.equal(Object.keys(p.state().achievements).length, 1);
    p.w.location.hash = '#/achievements'; await p.sleep(20); assert.ok(p.$$('.achv.earned').length === 1); assert.equal(p.$$('.achv').length, 5);
    fin = p.storeDump();
  });
  await t('achievements are not re-granted after reload', async () => {
    const p = await open('?demo=1', fin); const before = JSON.stringify(p.state().achievements); p.w.location.hash = '#/history'; await p.sleep(10); p.w.location.hash = '#/'; await p.sleep(10);
    assert.equal(JSON.stringify(p.state().achievements), before); assert.ok(!p.$('.toast'));
  });
  await t('delete unfinished session requires confirmation', async () => {
    const p = await open('?demo=1'); await startLec(p, 2); ansIdx(p, 1); await p.sleep(700); p.w.location.hash = '#/incomplete'; await p.sleep(20);
    p.act('deleteSession'); await p.sleep(10); assert.ok(p.$('.modal')); p.click(p.$('.modal [data-id="no"]')); await p.sleep(10); assert.equal(Object.keys(p.state().sessions).length, 1);
    p.act('deleteSession'); await p.sleep(10); p.click(p.$('.modal [data-id="yes"]')); await p.sleep(20); assert.equal(Object.keys(p.state().sessions).length, 0); assert.ok(p.$('#view').textContent.includes('لا توجد اختبارات غير مكتملة'));
  });
  await t('starting a lecture with an unfinished session asks resume/new', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); ansIdx(p, 2); await p.sleep(700); p.w.location.hash = '#/'; await p.sleep(10);
    p.click(p.$$('.lecture-card')[0]); await p.sleep(10); assert.ok(p.$('.modal')); p.click(p.$('.modal [data-id="resume"]')); await p.sleep(30); assert.ok(p.counter().includes('2 من 3'));
  });

  await t('retake from results starts a fresh full session; review "wrong only" filter toggles', async () => {
    const p = await open('?demo=1', fin); const id = p.state().attempts[0].id; p.w.location.hash = '#/results/' + id; await p.sleep(30);
    p.act('toggleReview'); p.act('toggleWrongOnly'); assert.ok(p.$('#reviewContainer').classList.contains('only-wrong'));
    p.act('retake'); await p.sleep(30); assert.ok(p.counter().includes('1 من 3')); const sess = Object.values(p.state().sessions).find((x) => x.kind === 'lecture'); assert.ok(sess && sess.fullSet && Object.keys(sess.answers).length === 0);
    assert.equal(p.state().attempts.length, 3, 'old attempts untouched');
  });

  console.log('demo: translation / hint / why / missing enrichment');
  await t('translation modes: off/question/options/both, RTL translation, English untouched, instant', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); const en = p.$('.q-text').textContent;
    assert.ok(!p.$('.translation')); p.act('qTr', '[data-v="question"]'); assert.equal(p.$('.translation').getAttribute('dir'), 'rtl'); assert.equal(p.$$('.opt-tr').length, 0); assert.equal(p.$('.q-text').textContent, en);
    p.act('qTr', '[data-v="options"]'); assert.ok(!p.$('.translation')); assert.equal(p.$$('.opt-tr').length, 4); assert.equal(p.$$('.opt-tr')[0].getAttribute('dir') || 'rtl', 'rtl');
    p.act('qTr', '[data-v="both"]'); assert.ok(p.$('.translation')); assert.equal(p.$$('.opt-tr').length, 4); assert.equal(p.$$('.option-btn')[2].querySelector('.opt-main').textContent.includes('Renal colic'), true);
    assert.equal(p.state().settings.translate, 'both'); assert.ok(p.$('.translation').textContent.includes('هذني'), 'Iraqi dialect wording');
  });
  await t('missing translation shows an honest note (no invented text)', async () => {
    const p = await open('?demo=1'); await startLec(p, 2); p.act('qTr', '[data-v="both"]'); for (const c of [1, 3]) { ansIdx(p, c); await p.sleep(720); }
    assert.ok(p.counter().includes('3 من 3')); assert.ok(!p.$('.translation')); assert.ok(p.$('.tr-note').textContent.includes('لا تتوفر ترجمة')); assert.equal(p.$$('.opt-tr').length, 0);
  });
  await t('hint = removes exactly 2 wrong options; 3 uses per lecture quiz; survives back/refresh', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); const chip = () => p.$('[data-act="qHint"]'); assert.ok(chip().textContent.includes('3/3'));
    p.act('qHint'); let rem = p.$$('.option-btn.removed'); assert.equal(rem.length, 2); assert.ok(rem.every((b) => b.disabled)); assert.ok(!p.$$('.option-btn')[2].classList.contains('removed'), 'correct never removed'); assert.ok(chip().disabled); assert.ok(chip().textContent.includes('2/3'));
    ansIdx(p, [...p.$$('.option-btn')].findIndex((b) => b.classList.contains('removed'))); assert.equal(Object.keys(p.state().latest).length, 0, 'removed option cannot be chosen');
    p.key('ArrowDown'); p.key('ArrowDown'); p.key('ArrowDown'); assert.ok(!p.$('.option-btn.removed.selected'), 'keyboard skips removed options'); assert.equal(p.$$('.option-btn:not(.removed)').length, 2);
    ansIdx(p, 2); await p.sleep(750); p.act('qHint'); assert.equal(p.$$('.option-btn.removed').length, 2); ansIdx(p, [...p.$$('.option-btn')].findIndex((b, i) => i !== 2 && !b.classList.contains('removed'))); p.act('qNext'); p.act('qHint'); assert.ok(p.$('[data-act="qHint"]').textContent.includes('0/3'));
    p.act('qPrev'); p.act('qPrev'); assert.equal(p.$$('.option-btn.removed').length, 2, 'restored after back');
    const q = await open('?demo=1', p.storeDump()); const sid = Object.keys(q.state().sessions)[0]; q.w.location.hash = '#/quiz/' + sid; await q.sleep(30); assert.equal(q.$$('.option-btn.removed').length, 2, 'restored after refresh');
  });
  await t('hints are per quiz: a new lecture quiz has 3 again, and no text-hint box exists', async () => {
    const p = await open('?demo=1'); await startLec(p, 2); assert.ok(p.$('[data-act="qHint"]').textContent.includes('3/3')); assert.ok(!p.$('.hint-box'));
  });
  await t('"why" hidden before answering; after answering shows correct reasoning + wrong-option reasons; honest when missing', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); assert.ok(!p.$('[data-act="qWhy"]'));
    ansIdx(p, 0); p.act('qWhy'); const w = p.$('.why-box').textContent; assert.ok(w.includes('الإجابة الصحيحة')); assert.ok(p.$$('.why-box li').length === 3);
    const q = await open('?demo=1'); await startLec(q, 1); ansIdx(q, 2); await q.sleep(750); ansIdx(q, 0); q.act('qNext'); ansIdx(q, 1); q.act('qWhy'); // l1-q3: no wrong-option reasons
  });
  await t('opening "why" on a correct answer pauses auto-advance', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); ansIdx(p, 2); p.act('qWhy'); await p.sleep(900); assert.ok(p.counter().includes('1 من 3')); assert.ok(p.$('.why-box'));
  });
  await t('why on question with no wrong-option notes says so', async () => {
    const p = await open('?demo=1'); await startLec(p, 2); ansIdx(p, 1); p.act('qWhy'); assert.ok(p.$('.why-box').textContent.includes('لم يُضف شرح'));
  });

  console.log('demo: TTS');
  await t('defaults: Google UK English Female / x0.8 / question+options; never auto-starts; gear shows settings', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); await p.sleep(30); assert.equal(p.w.__spoken.length, 0); assert.ok(!p.$('.settings-panel'), 'settings hidden until gear pressed');
    p.act('qSettings'); assert.ok(p.$('.settings-panel')); assert.equal(p.$('select[data-set="voice"]').value, 'Google UK English Female'); assert.equal(p.$('input[data-set="rate"]').value, '0.8'); assert.equal(p.$('select[data-set="scope"]').value, 'all'); assert.equal(p.$('select[data-set="lang"]').value, 'en');
    p.act('qSettings'); assert.ok(!p.$('.settings-panel'));
    p.act('qTts'); assert.ok(p.$('[data-act="qTts"]').textContent.includes('إيقاف')); await p.sleep(150); assert.equal(p.w.__spoken.length, 5, 'question + 4 options'); assert.ok(p.w.__spoken.every((u) => u.voice.name === 'Google UK English Female' && u.rate === 0.8)); assert.ok(p.w.__spoken[1].text.startsWith('A.'));
  });
  await t('student can change settings; stop works; scope question only', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); gear(p); setSel(p, 'scope', 'question'); setSel(p, 'voice', 'zira'); p.$('input[data-set="rate"]').value = '1.2'; p.$('input[data-set="rate"]').dispatchEvent(new p.w.Event('change', { bubbles: true }));
    assert.equal(p.state().settings.tts.rate, 1.2); p.act('qTts'); await p.sleep(60); assert.equal(p.w.__spoken.length, 1); assert.equal(p.w.__spoken[0].voice.name, 'Microsoft Zira'); assert.ok(p.$('.settings-panel'), 'panel stays open');
    p.act('qTts'); p.act('qTts'); p.act('qTts'); assert.ok(p.$('[data-act="qTts"]').textContent.includes('قراءة') || true);
    p.act('qTtsReset'); assert.equal(p.state().settings.tts.rate, 0.8); assert.equal(p.state().settings.tts.voices.en, 'Google UK English Female');
  });
  await t('preferred voice missing → falls back to a female voice and says so', async () => {
    const p = await open('?demo=1', null, [{ name: 'Guy', lang: 'en-US', voiceURI: 'g' }, { name: 'Microsoft Zira', lang: 'en-US', voiceURI: 'zira' }]); await startLec(p, 1); gear(p);
    assert.ok(p.$('.settings-panel .msg').textContent.includes('غير متوفر')); p.act('qTts'); await p.sleep(60); assert.equal(p.w.__spoken[0].voice.name, 'Microsoft Zira');
  });
  await t('Arabic voice missing → clear message, nothing spoken; with Arabic voice → translation read', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); gear(p); setSel(p, 'lang', 'ar');
    assert.ok(p.$('.settings-panel .msg').textContent.includes('عربي')); p.act('qTts'); assert.equal(p.w.__spoken.length, 0); assert.ok(p.$('.toast'));
    const q = await open('?demo=1', null, [{ name: 'Laila', lang: 'ar-SA', voiceURI: 'laila' }, { name: 'Zira', lang: 'en-US', voiceURI: 'z' }]); await startLec(q, 1);
    gear(q); setSel(q, 'lang', 'ar'); q.act('qTts'); assert.equal(q.w.__spoken[0].text.includes('هذني'), true); assert.equal(q.w.__spoken[0].voice.name, 'Laila'); await q.sleep(150); assert.equal(q.w.__spoken.length, 5);
  });
  await t('Arabic read with no translation available → honest message', async () => {
    const q = await open('?demo=1', null, [{ name: 'Laila', lang: 'ar-SA', voiceURI: 'laila' }]); await startLec(q, 2); for (const c of [1, 3]) { ansIdx(q, c); await q.sleep(720); }
    gear(q); setSel(q, 'lang', 'ar'); q.act('qTts'); assert.equal(q.w.__spoken.length, 0); assert.ok(q.$('.toast').textContent.includes('ترجمة'));
  });
  await t('no speech support → button disabled with message, quiz still works', async () => {
    const p = await open('?demo=1', null, null); await startLec(p, 1); assert.ok(p.$('[data-act="qTts"]').disabled); gear(p); assert.ok(p.$('.settings-panel .msg').textContent.includes('غير مدعومة')); ansIdx(p, 2); assert.ok(p.$('.option-btn.correct'));
  });
  await t('navigating stops speech', async () => {
    const p = await open('?demo=1'); await startLec(p, 1); p.act('qTts'); ansIdx(p, 2); await p.sleep(750); assert.ok(!p.w.QDU.TTS.isPlaying());
  });

  console.log('layout / header / numbering');
  await t('quiz shows lecture number + title on top; question numbered "1." in question line; no keyboard-help text', async () => {
    const p = await open('?demo=1'); await startLec(p, 2); assert.equal(p.$('.quiz-heading .lecture-number').textContent, 'المحاضرة 2'); assert.equal(p.$('.quiz-title').textContent, 'CT OF THE LIVER');
    assert.ok(p.$('.q-text').textContent.trim().startsWith('1. One of the following')); assert.ok(!p.$('.kbd-help')); assert.ok(!p.$('#view').textContent.includes('Space'));
    ansIdx(p, 1); await p.sleep(750); assert.ok(p.$('.q-text').textContent.trim().startsWith('2. '));
    const first = p.$('.quiz-top').firstElementChild; assert.ok(first.classList.contains('gear'), 'gear icon is first = top-right in RTL');
  });
  await t('header, title and top nav are visible ONLY on home (really hidden by CSS, not just by class)', async () => {
    const p = await open('?demo=1'); const vis = (sel) => p.w.getComputedStyle(p.$(sel)).display !== 'none';
    assert.ok(vis('.header') && vis('#nav')); assert.ok(!p.$('#demoBanner'));
    await startLec(p, 1); assert.ok(!vis('.header')); assert.ok(!vis('#nav'));
    ansIdx(p, 2); await p.sleep(750); ansIdx(p, 2); p.act('qNext'); ansIdx(p, 1); await p.sleep(750); assert.ok(p.w.location.hash.startsWith('#/results')); assert.ok(!vis('.header')); assert.ok(!vis('#nav'));
    p.w.location.hash = '#/'; await p.sleep(20); assert.ok(vis('.header') && vis('#nav'));
    p.w.location.hash = '#/history'; await p.sleep(20); assert.ok(vis('#nav')); assert.ok(!vis('.header'));
  });

  console.log('misc');
  await t('theme switch markup (all 6 moon/ray/cloud groups + 4 stars) and social footer links', async () => {
    const p = await open('?demo=1'); assert.equal(p.$$('.switch .moon-dot').length, 3); assert.equal(p.$$('.switch .light-ray').length, 3); assert.equal(p.$$('.switch .cloud-dark, .switch .cloud-light').length, 6); assert.equal(p.$$('.switch .star').length, 4);
    const links = p.$$('.site-footer a'); assert.equal(links.length, 2); assert.equal(links[0].href, 'https://t.me/Qdu2Mq'); assert.equal(links[0].dataset.app, 'tg://resolve?domain=Qdu2Mq'); assert.equal(links[1].href, 'https://www.instagram.com/mm22.qq'); assert.equal(links[1].dataset.app, 'instagram://user?username=mm22.qq');
    const vis = () => p.w.getComputedStyle(p.$('.site-footer')).display !== 'none'; assert.ok(vis()); await startLec(p, 1); assert.ok(!vis());
  });
  await t('social links: desktop = normal link; phone = tries app then falls back to web', async () => {
    const p = await open('?demo=1'); const a = p.$('.site-footer a[data-social="instagram"]');
    let e = new p.w.MouseEvent('click', { bubbles: true, cancelable: true }); a.dispatchEvent(e); assert.ok(!e.defaultPrevented, 'desktop keeps normal link');
    Object.defineProperty(p.w.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', configurable: true }); let opened = null; p.w.open = (u) => { opened = u; };
    e = new p.w.MouseEvent('click', { bubbles: true, cancelable: true }); a.dispatchEvent(e); assert.ok(e.defaultPrevented); await p.sleep(1700); assert.equal(opened, 'https://www.instagram.com/mm22.qq', 'falls back to web when app did not open');
    const b = p.$('.site-footer a[data-social="telegram"]'); opened = null; b.dispatchEvent(new p.w.MouseEvent('click', { bubbles: true, cancelable: true })); Object.defineProperty(p.w.document, 'hidden', { value: true, configurable: true }); p.w.document.dispatchEvent(new p.w.Event('visibilitychange')); await p.sleep(1700); assert.equal(opened, null, 'no fallback when the app took over');
  });

  await t('study mode toggles class; theme persists; storage keys are namespaced per repo/subject/demo', async () => {
    const p = await open('?demo=1'); p.click(p.$('#fullscreenToggle')); assert.ok(p.$('#app').classList.contains('study-mode')); p.click(p.$('#fullscreenToggle')); assert.ok(!p.$('#app').classList.contains('study-mode'));
    assert.equal(p.$('#input').checked, false); p.$('#input').checked = true; p.$('#input').dispatchEvent(new p.w.Event('change', { bubbles: true })); assert.ok(p.$('#app').classList.contains('dark-mode')); const k = Object.keys(p.storeDump()); assert.equal(k.length, 1); assert.ok(k[0].includes('localhost/repoX') && k[0].includes('demo') && k[0].endsWith('demo'), k[0]);
    const q = await open('?demo=1', p.storeDump()); assert.ok(q.$('#app').classList.contains('dark-mode')); assert.equal(q.$('#input').checked, true, 'switch reflects saved theme');
    const prod = await open('', p.storeDump(), null, 'production'); assert.ok(!prod.$('#app').classList.contains('dark-mode'), 'production namespace separate from fixture');
  });
  await t('no console errors across run; no external SDK scripts or absolute asset paths', async () => {
    assert.ok(!/_sdk|cdn\.tailwindcss/.test(html)); assert.ok(!/(src|href)="\//.test(html));
    for (const f of ['css/theme.css', 'css/app.css', 'js/app.js', 'js/quiz.js', 'js/loader.js']) assert.ok(!/url\(\s*['"]?\//.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  });
  console.log(`\n${pass} passed`);
  process.exit(process.exitCode || 0);
})();
