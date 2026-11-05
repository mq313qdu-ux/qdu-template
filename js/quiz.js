/* QDU quiz engine UI: question view, keyboard, translation, hints, TTS, results. Subject-agnostic. */
(function (g) {
  const QDU = g.QDU, U = QDU.util, C = QDU.core, TTS = QDU.TTS, esc = U.esc;
  const $ = (s) => document.querySelector(s);
  const Quiz = (QDU.Quiz = {});
  const ADVANCE_MS = 550; // within the required 450–700ms window
  let session = null, ui = {}, advanceTimer = null, tickTimer = null, lastTick = null, ticks = 0, ctrlSolo = false;
  const App = () => QDU.App;
  const st = () => App().state, content = () => App().content;
  const curQ = () => content().qById.get(session.qids[session.idx]);
  const resetUi = () => { ui = { sel: -1, hint: false, why: false, fresh: false, ttsOpen: ui.ttsOpen || false }; };

  /* ---------- time / autosave ---------- */
  function tick() { const now = Date.now(); if (session && lastTick) session.elapsedMs = (session.elapsedMs || 0) + Math.min(now - lastTick, 5000); lastTick = now; }
  function persist() { if (session) { tick(); App().save(); } }
  function startTimers() {
    clearInterval(tickTimer); lastTick = Date.now(); ticks = 0;
    tickTimer = setInterval(() => {
      if (!session || document.visibilityState !== 'visible') return;
      tick(); const el = $('#quizTimer'); if (el) el.textContent = '⏱ ' + U.fmtDur(session.elapsedMs);
      if (++ticks % 5 === 0) App().save();
    }, 1000);
  }
  function cancelAdvance() { if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; } }

  /* ---------- starting sessions ---------- */
  Quiz.startWith = async function (kind, lectureId, qids, title) {
    const A = App();
    if (!qids.length) return A.toast('لا توجد أسئلة متاحة لهذا الاختبار', 'bad');
    const lid = lectureId == null ? null : lectureId;
    const ex = Object.values(st().sessions).find((s) => s.kind === kind && s.lectureId === lid);
    if (ex) {
      const r = await A.dialog({ title: 'لديك اختبار غير مكتمل', text: `«${ex.title}» — أُجيب عن ${Object.keys(ex.answers).length} من ${ex.qids.length}. هل تريد الاستكمال أم البدء من جديد (يحذف التقدم السابق)؟`,
        buttons: [{ id: 'cancel', label: 'إلغاء' }, { id: 'new', label: 'بدء جديد', cls: 'danger' }, { id: 'resume', label: 'استكمال', cls: 'primary' }] });
      if (r === 'resume') return A.go('#/quiz/' + ex.id);
      if (r !== 'new') return;
      delete st().sessions[ex.id];
    }
    const s = C.newSession(content(), kind, lid, qids, Date.now(), title);
    st().sessions[s.id] = s; A.save(); A.go('#/quiz/' + s.id);
  };
  Quiz.start = function (kind, lectureId) {
    const c = content(), s = st();
    if (kind === 'lecture') { const l = c.lectureById.get(lectureId); return Quiz.startWith('lecture', lectureId, (c.byLecture.get(lectureId) || []).map((q) => q.id), l ? l.title : ''); }
    if (kind === 'favorites') return Quiz.startWith('favorites', null, C.favoriteIds(s, c), 'اختبار من المفضلة');
    return Quiz.startWith('mistakes', null, C.activeMistakeIds(s, c), 'اختبار من الأخطاء');
  };

  /* ---------- quiz view ---------- */
  Quiz.view = function (sid) {
    const s = st().sessions[sid]; if (!s) return false;
    session = s; resetUi(); ui.ttsOpen = false; startTimers(); renderQuiz(); window.scrollTo(0, 0); return true;
  };
  Quiz.leave = function () {
    if (session) persist();
    cancelAdvance(); TTS.stop(); clearInterval(tickTimer); tickTimer = null; session = null; lastTick = null;
    const cv = $('#confettiCanvas'); if (cv) cv.remove();
  };
  Quiz.hasUnsaved = () => !!session && Object.keys(session.answers).length > 0;
  Quiz.active = () => session;

  function trData(en) { const t = en && en.translation; return t && typeof t === 'object' ? t : null; }

  function renderQuiz() {
    const q = curQ(), A = App(), s = st(), set = s.settings, en = content().enrichment.get(q.id) || {};
    const fresh = ui.fresh; ui.fresh = false;
    const ans = session.answers[q.id], n = session.qids.length, idx = session.idx, last = idx === n - 1;
    const tr = trData(en), mode = set.translate, showQ = mode === 'question' || mode === 'both', showO = mode === 'options' || mode === 'both';
    const isFav = !!s.favorites[q.id];
    const optHtml = q.options.map((o, i) => {
      const cls = ['option-btn'];
      if (ans) { if (i === q.correct) cls.push('correct'); if (i === ans.choice && !ans.isCorrect) cls.push('incorrect'); } else if (i === ui.sel) cls.push('selected');
      const t = showO && tr && Array.isArray(tr.options) && tr.options[i] ? `<span class="opt-tr">${esc(tr.options[i])}</span>` : '';
      return `<button class="${cls.join(' ')}" data-act="qAnswer" data-i="${i}" ${ans ? 'disabled' : ''} aria-pressed="${i === ui.sel}"><span class="opt-main"><span class="opt-letter">${U.letter(i)})</span><span>${esc(o)}</span></span>${t}${fresh && ans && ans.isCorrect && i === q.correct ? '<span class="burst">✨</span>' : ''}</button>`;
    }).join('');

    let trBlock = '';
    if (showQ) trBlock = tr && tr.q ? `<div class="translation" lang="ar" dir="rtl">${esc(tr.q)}</div>` : `<div class="tr-note">لا تتوفر ترجمة لهذا السؤال بعد.</div>`;
    if (showO && !(tr && Array.isArray(tr.options) && tr.options.length)) trBlock += `<div class="tr-note">لا تتوفر ترجمة للاختيارات بعد.</div>`;

    let extra = '';
    if (!ans && ui.hint) extra += `<div class="hint-box">💡 ${en.hint ? esc(en.hint) : 'لا يتوفر تلميح لهذا السؤال بعد.'}</div>`;
    if (ans && !ans.isCorrect) extra += `<div class="feedback-box error">❌ الإجابة الصحيحة: <span class="ltr-tag" dir="ltr">${U.letter(q.correct)}) ${esc(q.options[q.correct])}</span><br>${en.explanation ? esc(en.explanation) : 'لا يتوفر شرح لهذا السؤال بعد.'}</div>`;
    if (ans && ui.why) extra += whyHtml(q, en);

    const ttsOk = TTS.supported(), lang = set.tts.lang, vs = TTS.voicesFor(lang), sel = (set.tts.voices || {})[lang] || '';
    const ttsMsg = !ttsOk ? 'القراءة الصوتية غير مدعومة في هذا المتصفح.' : !vs.length ? (lang === 'ar' ? 'لا يتوفر صوت عربي على هذا الجهاز؛ جرّب القراءة بالإنجليزية أو ثبّت صوتًا عربيًا من إعدادات النظام.' : 'لم يُعثر على صوت إنجليزي مخصص؛ سيُستخدم الصوت الافتراضي.') : '';
    const playing = TTS.isPlaying();

    $('#view').innerHTML = `<div class="quiz-container">
      <div class="quiz-header">
        <div class="quiz-top"><button class="btn ghost sm" data-act="qExit">✕ خروج</button><h2 class="quiz-title">${esc(session.title)}</h2></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${((idx + 1) / n) * 100}%"></div></div>
        <div class="quiz-meta"><span>السؤال ${idx + 1} من ${n}</span><span class="timer" id="quizTimer">⏱ ${U.fmtDur(session.elapsedMs)}</span></div>
      </div>
      <div class="toolbar">
        <button class="chip ${isFav ? 'on' : ''}" data-act="qFav" aria-pressed="${isFav}">${isFav ? '⭐ في المفضلة' : '☆ مفضلة'}</button>
        ${ans ? `<button class="chip ${ui.why ? 'on' : ''}" data-act="qWhy">🧠 لماذا هذه الإجابة؟</button>` : `<button class="chip ${ui.hint ? 'on' : ''}" data-act="qHint">💡 تلميح</button>`}
        <span class="seg" role="group" aria-label="الترجمة">${[['off', 'بدون ترجمة'], ['question', 'السؤال'], ['options', 'الاختيارات'], ['both', 'الكل']].map(([v, l]) => `<button class="${mode === v ? 'on' : ''}" data-act="qTr" data-v="${v}">${l}</button>`).join('')}</span>
        <button class="chip ${playing ? 'on' : ''}" data-act="qTts" ${ttsOk ? '' : 'disabled'}>${playing ? '⏹ إيقاف' : '🔊 قراءة'}</button>
        <details class="tts-panel" ${ui.ttsOpen ? 'open' : ''}><summary>⚙ إعدادات القراءة الصوتية</summary>
          <div class="field"><label>المحتوى</label><select data-set="scope"><option value="question" ${set.tts.scope === 'question' ? 'selected' : ''}>السؤال فقط</option><option value="all" ${set.tts.scope === 'all' ? 'selected' : ''}>السؤال مع الاختيارات</option></select></div>
          <div class="field"><label>اللغة</label><select data-set="lang"><option value="en" ${lang === 'en' ? 'selected' : ''}>English (النص الأصلي)</option><option value="ar" ${lang === 'ar' ? 'selected' : ''}>العربية (الترجمة)</option></select></div>
          <div class="field"><label>الصوت</label><select data-set="voice" ${vs.length ? '' : 'disabled'}><option value="">تلقائي (صوت نسائي إن وُجد)</option>${vs.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === sel ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select></div>
          <div class="field"><label>السرعة</label><input type="range" data-set="rate" min="0.6" max="1.4" step="0.1" value="${set.tts.rate}"><span>${set.tts.rate}×</span></div>
          ${ttsMsg ? `<div class="msg">${ttsMsg}</div>` : ''}
        </details>
      </div>
      <div class="question-section">
        <div class="question-header"><div class="question-text q-text" dir="ltr" lang="en">${esc(q.text)}</div></div>
        ${trBlock}
        <div class="options-container">${optHtml}</div>
        ${extra}
        <div class="nav-row"><button class="prev-btn" data-act="qPrev" ${idx === 0 ? 'disabled' : ''}>→ السابق</button>
          <button class="next-btn" data-act="qNext" ${ans ? '' : 'disabled'}>${last ? 'إنهاء وعرض النتيجة' : 'التالي ←'}</button></div>
      </div>
      <div class="kbd-help">↑ ↓ لتحديد الاختيار · Space أو Ctrl لتأكيده · ← السابق · → التالي</div></div>`;
  }

  function whyHtml(q, en) {
    const why = en.why || {}, wrong = why.wrong || {};
    const corr = why.correct || en.explanation;
    const items = q.options.map((o, i) => (i !== q.correct && wrong[i] ? `<li><span class="ltr-tag">${U.letter(i)})</span> ${esc(wrong[i])}</li>` : '')).join('');
    const missingSome = q.options.some((o, i) => i !== q.correct && !wrong[i]);
    return `<div class="why-box"><h4>🧠 لماذا هذه الإجابة؟</h4>
      <p><b>الإجابة الصحيحة <span class="ltr-tag">${U.letter(q.correct)})</span>:</b> ${corr ? esc(corr) : 'لا يتوفر تعليل لهذه الإجابة بعد.'}</p>
      ${items ? `<b>سبب عدم صحة البدائل:</b><ul>${items}</ul>` : ''}
      ${missingSome ? `<p style="margin:0;opacity:.8">${items ? 'لم يُضف شرح لباقي البدائل بعد.' : 'لم يُضف شرح للبدائل الأخرى بعد.'}</p>` : ''}</div>`;
  }

  /* ---------- navigation inside quiz ---------- */
  function answer(i) {
    if (!session || App().modalOpen()) return;
    const q = curQ(); if (session.answers[q.id]) return;
    const r = C.recordAnswer(st(), content(), session, q.id, i, Date.now());
    if (!r.ok) return;
    ui.sel = i; ui.fresh = true; ui.hint = false; persist();
    r.newAchievements.forEach((a) => App().toast('🏅 إنجاز جديد: ' + a.title, 'gold', 3800));
    renderQuiz(); App().renderNav();
    if (r.isCorrect) {
      const sid = session.id, at = session.idx;
      cancelAdvance();
      advanceTimer = setTimeout(() => { advanceTimer = null; if (session && session.id === sid && session.idx === at) next(); }, ADVANCE_MS);
    }
  }
  function go(i) { cancelAdvance(); TTS.stop(); session.idx = i; session.updatedAt = Date.now(); resetUi(); persist(); renderQuiz(); }
  function prev() { if (session && session.idx > 0) go(session.idx - 1); }
  function next() {
    if (!session) return;
    const q = curQ();
    if (!session.answers[q.id]) return App().toast('اختر إجابة أولًا', '');
    if (session.idx < session.qids.length - 1) go(session.idx + 1); else finish();
  }
  function finish() {
    cancelAdvance(); TTS.stop(); tick();
    const un = session.qids.findIndex((id) => !session.answers[id]);
    if (un >= 0) { go(un); return App().toast('بقيت أسئلة بلا إجابة', ''); }
    const r = C.finalizeSession(st(), content(), session, Date.now());
    App().save(); clearInterval(tickTimer); session = null;
    r.newAchievements.forEach((a) => App().toast('🏅 إنجاز جديد: ' + a.title, 'gold', 3800));
    App().go('#/results/' + r.attempt.id);
  }

  /* ---------- TTS ---------- */
  function ttsSegments(q, en) {
    const set = st().settings.tts, all = set.scope === 'all';
    if (set.lang === 'en') { const segs = [{ text: q.text, lang: 'en' }]; if (all) q.options.forEach((o, i) => segs.push({ text: U.letter(i) + '. ' + o, lang: 'en' })); return { segs }; }
    const tr = trData(en); if (!tr || !tr.q) return { error: 'لا توجد ترجمة عربية لقراءتها لهذا السؤال.' };
    const segs = [{ text: tr.q, lang: 'ar' }];
    if (all && Array.isArray(tr.options)) tr.options.forEach((o, i) => segs.push({ text: 'الخيار ' + TTS.ordinal(i) + ': ' + o, lang: 'ar' }));
    return { segs };
  }
  function toggleTts() {
    if (TTS.isPlaying()) { TTS.stop(); return renderQuiz(); }
    const set = st().settings.tts, q = curQ(), r = ttsSegments(q, content().enrichment.get(q.id));
    if (r.error) return App().toast(r.error, 'bad', 3500);
    const res = TTS.speak(r.segs, { voices: set.voices || {}, rate: set.rate, onEnd: () => { if (session) renderQuiz(); } });
    if (!res.ok) return App().toast(res.reason === 'unsupported' ? 'القراءة الصوتية غير مدعومة في هذا المتصفح' : res.reason === 'novoice-ar' ? 'لا يتوفر صوت عربي على هذا الجهاز' : 'لا يوجد نص للقراءة', 'bad', 3500);
    renderQuiz();
  }

  /* ---------- actions ---------- */
  function registerActions() {
    Object.assign(App().actions, {
      qAnswer: (b) => answer(+b.dataset.i),
      qPrev: prev, qNext: next,
      qFav: () => { const q = curQ(), on = C.toggleFavorite(st(), q, Date.now()); App().save(); renderQuiz(); App().renderNav(); App().toast(on ? '⭐ أُضيف إلى المفضلة' : 'أُزيل من المفضلة'); },
      qHint: () => { ui.hint = !ui.hint; renderQuiz(); },
      qWhy: () => { cancelAdvance(); ui.why = !ui.why; renderQuiz(); },  // opening the explanation pauses the auto-advance
      qTr: (b) => { st().settings.translate = b.dataset.v; App().save(); renderQuiz(); },
      qTts: toggleTts,
      qExit: async () => {
        cancelAdvance();
        if (!Quiz.hasUnsaved()) { delete st().sessions[session.id]; App().save(); session = null; return App().go('#/'); }
        const r = await App().dialog({ title: 'اختبارك غير مكتمل', text: 'تم حفظ تقدمك تلقائيًا، ويمكنك استكمال الاختبار لاحقًا من صفحة «غير المكتملة». هل تريد الخروج الآن؟',
          buttons: [{ id: 'stay', label: 'متابعة الاختبار', cls: 'primary' }, { id: 'exit', label: 'حفظ والخروج' }] });
        if (r === 'exit') App().go('#/');
      },
      retake: (b) => {
        const a = st().attempts.find((x) => x.id === b.dataset.id); if (!a) return;
        const c = content();
        if (a.kind === 'lecture') { const l = c.lectureById.get(a.lectureId); if (!l) return App().toast('هذه المحاضرة لم تعد موجودة في المحتوى', 'bad'); return Quiz.start('lecture', a.lectureId); }
        const ids = a.items.map((i) => i.qid).filter((id) => c.qById.has(id));
        return Quiz.startWith(a.kind, null, ids, a.title);
      },
      toggleReview: (b) => { const el = $('#reviewContainer'); el.classList.toggle('hidden'); b.textContent = el.classList.contains('hidden') ? 'مراجعة كاملة' : 'إخفاء المراجعة'; },
      toggleWrongOnly: (b) => { $('#reviewContainer').classList.toggle('only-wrong'); b.classList.toggle('on'); }
    });
  }

  /* ---------- global input: keyboard, protect, lifecycle ---------- */
  const isEditable = (t) => !!t && t.nodeType === 1 && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  Quiz.init = function () {
    registerActions();
    const view = $('#view');
    view.addEventListener('change', (e) => {
      const k = e.target.dataset && e.target.dataset.set; if (!k) return;
      const t = st().settings.tts; TTS.stop();
      if (k === 'rate') t.rate = +e.target.value; else if (k === 'voice') { t.voices = t.voices || {}; t.voices[t.lang] = e.target.value; } else t[k] = e.target.value;
      App().save(); if (session) renderQuiz();
    });
    view.addEventListener('toggle', (e) => { if (e.target.classList && e.target.classList.contains('tts-panel')) ui.ttsOpen = e.target.open; }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Control') { ctrlSolo = !e.repeat; return; }
      ctrlSolo = false;
      if (!session || !App().route || App().route.name !== 'quiz' || App().modalOpen() || isEditable(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const answered = !!session.answers[curQ().id], n = curQ().options.length;
      const interactive = e.target.closest && e.target.closest('button,a,summary,[tabindex]');
      switch (e.key) {
        case 'ArrowDown': case 'ArrowUp':
          if (answered) return; e.preventDefault();
          ui.sel = ui.sel < 0 ? (e.key === 'ArrowDown' ? 0 : n - 1) : (ui.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
          renderQuiz(); { const el = document.querySelector('.option-btn.selected'); el && el.scrollIntoView && el.scrollIntoView({ block: 'nearest' }); }
          break;
        case ' ':
          if (interactive && !e.target.classList.contains('option-btn')) return;
          e.preventDefault(); confirmSel(); break;
        case 'ArrowRight': e.preventDefault(); next(); break;
        case 'ArrowLeft': e.preventDefault(); prev(); break;
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.key !== 'Control') return;
      const ok = ctrlSolo; ctrlSolo = false;
      if (ok && session && App().route.name === 'quiz' && !App().modalOpen() && !isEditable(e.target)) confirmSel();
    });
    ['mousedown', 'wheel', 'touchstart'].forEach((ev) => g.addEventListener(ev, () => { ctrlSolo = false; }, { passive: true }));
    g.addEventListener('blur', () => { ctrlSolo = false; });

    g.addEventListener('beforeunload', (e) => { if (Quiz.hasUnsaved() && App().route.name === 'quiz') { persist(); e.preventDefault(); e.returnValue = ''; return ''; } });
    g.addEventListener('pagehide', () => { persist(); TTS.stop(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { persist(); lastTick = null; } else lastTick = Date.now(); });
    if (TTS.supported()) { try { g.speechSynthesis.addEventListener('voiceschanged', () => { if (session && !TTS.isPlaying()) renderQuiz(); }); } catch (e) {} }
  };
  function confirmSel() {
    if (!session) return;
    if (session.answers[curQ().id]) return;
    if (ui.sel < 0) return App().toast('حدّد اختيارًا بالأسهم ↑ ↓ أولًا', '');
    answer(ui.sel);
  }

  Quiz.protect = function () {
    const stop = (e) => { if (!isEditable(e.target)) e.preventDefault(); };
    ['contextmenu', 'copy', 'cut', 'paste', 'selectstart'].forEach((ev) => document.addEventListener(ev, (e) => { const t = e.target.nodeType === 1 ? e.target : e.target.parentElement; if (!isEditable(t)) e.preventDefault(); }));
    document.addEventListener('keydown', (e) => {
      if (isEditable(e.target)) return;
      if (((e.ctrlKey || e.metaKey) && ['c', 'x', 'a', 'u', 's'].includes(e.key.toLowerCase())) || e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) e.preventDefault();
    });
  };

  /* ---------- results ---------- */
  function animateValue(el, from, to, dur) {
    if (!el) return; const t0 = performance.now();
    (function step(t) { const p = Math.min((t - t0) / dur, 1); el.textContent = Math.floor(from + (to - from) * (1 - Math.pow(1 - p, 4))); if (p < 1) requestAnimationFrame(step); })(t0);
  }
  function confetti(count) {
    if (g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const old = $('#confettiCanvas'); if (old) old.remove();
    const canvas = document.createElement('canvas'); canvas.id = 'confettiCanvas'; canvas.className = 'confetti-canvas';
    canvas.width = innerWidth; canvas.height = innerHeight; document.body.appendChild(canvas);
    const ctx = canvas.getContext && canvas.getContext('2d'); if (!ctx) return;
    const ps = Array.from({ length: count }, () => ({ x: Math.random() * canvas.width, y: Math.random() * canvas.height - canvas.height, r: Math.random() * 6 + 4, d: Math.random() * 150, color: `hsl(${Math.random() * 360},70%,60%)`, tilt: 0, inc: Math.random() * 0.07 + 0.05, ang: 0 }));
    let alive = true; setTimeout(() => { alive = false; canvas.remove(); }, 5000);
    (function draw() {
      if (!alive) return; ctx.clearRect(0, 0, canvas.width, canvas.height);
      ps.forEach((p, i) => { ctx.beginPath(); ctx.lineWidth = p.r / 2; ctx.strokeStyle = p.color; ctx.moveTo(p.x + p.tilt + p.r, p.y); ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r); ctx.stroke();
        p.ang += p.inc; p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2; p.tilt = Math.sin(p.ang - i / 3) * 15; if (p.y > canvas.height) { p.x = Math.random() * canvas.width; p.y = -30; } });
      requestAnimationFrame(draw);
    })();
  }

  Quiz.results = function (id) {
    const A = App(), a = st().attempts.find((x) => x.id === id); if (!a) return false;
    const rt = C.rating(a.pct), tone = rt.key === 'perfect' ? 'excellent' : rt.key;
    const c = content();
    const review = a.items.map((it, i) => {
      const live = c.qById.has(it.qid), en = c.enrichment.get(it.qid), ex = (en && en.explanation) || it.explanation;
      return `<div class="review-q ${it.isCorrect ? 'ok' : 'no'}"><div>${it.isCorrect ? '✅' : '❌'} سؤال ${i + 1}${live ? '' : ' <span class="badge warn">محذوف من المحتوى الحالي</span>'}</div>
        <div class="q">${esc(it.text)}</div>
        ${it.isCorrect ? '' : `<div class="a u">إجابتك: ${U.letter(it.choice)}) ${esc(it.options[it.choice])}</div>`}
        <div class="a c">الإجابة الصحيحة: ${U.letter(it.correct)}) ${esc(it.options[it.correct])}</div>
        <div class="ex">${ex ? esc(ex) : '<span style="opacity:.7">لا يتوفر شرح لهذا السؤال.</span>'}</div></div>`;
    }).join('');
    $('#view').innerHTML = `<div class="quiz-container"><div class="results-container">
      <h2 style="font-size:2rem;margin-bottom:6px;font-family:'Tajawal',sans-serif">النتيجة النهائية</h2>
      <div class="item-sub" style="margin-bottom:12px;direction:auto">${esc(a.title)}</div>
      <div class="results-chart-wrapper"><svg viewBox="0 0 200 200" class="circular-progress"><circle class="progress-ring-bg" cx="100" cy="100" r="85"></circle><circle class="progress-ring ${tone}" id="progressRing" cx="100" cy="100" r="85" stroke-dasharray="534" stroke-dashoffset="534"></circle></svg>
        <div class="results-center-content"><div class="results-score ${tone}" id="finalScore">0%</div><div class="results-label">النسبة المئوية</div></div></div>
      <div class="performance-badge ${rt.cls}">${rt.label}</div>
      <div class="results-meta"><span class="badge">الدرجة: <b>${a.correct} / ${a.total}</b></span><span class="badge">⏱ ${U.fmtDur(a.durationMs)}</span><span class="badge">📅 ${esc(U.fmtDate(a.completedAt))}</span></div>
      <div class="results-stats">
        <div class="stat-card correct-card"><div class="stat-icon">✅</div><div class="stat-value" id="rc">0</div><div class="stat-label">إجابات صحيحة</div></div>
        <div class="stat-card wrong-card"><div class="stat-icon">❌</div><div class="stat-value" id="rw">0</div><div class="stat-label">إجابات خاطئة</div></div>
        <div class="stat-card total-card"><div class="stat-icon">📊</div><div class="stat-value" id="rt">0</div><div class="stat-label">مجموع الأسئلة</div></div></div>
      <p class="results-message">${rt.msg}</p>
      <div class="action-buttons"><button class="action-btn primary-btn" data-act="retake" data-id="${esc(a.id)}">إعادة الاختبار</button>
        <button class="action-btn secondary-btn" data-act="toggleReview">مراجعة كاملة</button>
        <a class="action-btn secondary-btn" style="text-decoration:none;display:inline-block" href="#/history">السجل</a>
        <a class="action-btn secondary-btn" style="text-decoration:none;display:inline-block" href="#/">الرئيسية</a></div>
      <div id="reviewContainer" class="hidden review-section"><button class="chip" data-act="toggleWrongOnly">الأخطاء فقط</button>${review}</div>
    </div></div>`;
    animateValue($('#rc'), 0, a.correct, 1200); animateValue($('#rw'), 0, a.wrong, 1200); animateValue($('#rt'), 0, a.total, 1200);
    const sc = $('#finalScore'); let p = 0; const step = Math.max(1, Math.round(a.pct / 60));
    const iv = setInterval(() => { p = Math.min(a.pct, p + step); sc.textContent = Math.round(p) + '%'; if (p >= a.pct) clearInterval(iv); }, 20);
    setTimeout(() => { const ring = $('#progressRing'); if (ring) ring.style.strokeDashoffset = 2 * Math.PI * 85 * (1 - a.pct / 100); }, 100);
    if (!a.celebrated) { a.celebrated = true; A.save(); if (a.pct >= 90) confetti(a.pct >= 100 ? 260 : 150); }
    window.scrollTo(0, 0);
    return true;
  };
})(window);
