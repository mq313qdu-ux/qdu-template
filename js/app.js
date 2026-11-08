/* QDU app shell: boot, router, pages (home, favorites, mistakes, incomplete, history, achievements). */
(function (g) {
  const QDU = g.QDU, U = QDU.util, C = QDU.core, S = QDU.Storage, esc = U.esc;
  const $ = (s) => document.querySelector(s);
  const App = (QDU.App = { actions: {}, route: null });
  const KIND = { lecture: 'محاضرة', favorites: 'المفضلة', mistakes: 'الأخطاء' };

  /* ---------- helpers ---------- */
  App.toast = function (msg, kind, ms) {
    const el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = msg;
    $('#toasts').appendChild(el); setTimeout(() => el.remove(), ms || 2600);
  };
  App.save = function () {
    const ok = App.store.save();
    if (!ok && !App._saveWarned) { App._saveWarned = true; App.toast(App.store.readOnly ? 'البيانات المحفوظة من إصدار أحدث: لن يتم الحفظ' : 'تعذّر الحفظ في المتصفح', 'bad', 4000); }
    return ok;
  };
  // dialog({title,text,buttons:[{id,label,cls}]}) -> Promise<id|null>
  App.dialog = function (o) {
    return new Promise((resolve) => {
      const root = $('#modalRoot');
      root.innerHTML = `<div class="modal-back" role="dialog" aria-modal="true"><div class="modal"><h3>${esc(o.title)}</h3><p>${esc(o.text)}</p><div class="actions">${o.buttons.map((b) => `<button class="btn ${b.cls || 'ghost'}" data-id="${esc(b.id)}">${esc(b.label)}</button>`).join('')}</div></div></div>`;
      const done = (v) => { root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      root.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => done(b.dataset.id)));
      const first = root.querySelector('button'); first && first.focus();
    });
  };
  App.modalOpen = () => !!$('#modalRoot').firstChild;
  App.go = (hash) => { if (location.hash === hash) App.render(); else location.hash = hash; };
  App.lectureTitle = (id) => { const l = App.content.lectureById.get(id); return l ? l.title : null; };

  function applyTheme() {
    const dark = App.state.settings.dark, app = $('#app');
    app.classList.toggle('dark-mode', dark); app.classList.toggle('light-mode', !dark);
    $('#input').checked = dark;
  }
  function toggleStudy() {
    const app = $('#app'), on = !app.classList.contains('study-mode');
    app.classList.toggle('study-mode', on);
    try {
      if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen();
    } catch (e) {}
  }

  /* ---------- nav ---------- */
  function renderNav(r) {
    const st = App.state, c = App.content;
    const tabs = [['', '🏠 الرئيسية', 0], ['favorites', '⭐ المفضلة', C.favoriteIds(st, c).length], ['mistakes', '❌ الأخطاء', C.activeMistakeIds(st, c).length],
      ['incomplete', '⏸ غير المكتملة', Object.keys(st.sessions).length], ['history', '🕘 السجل', st.attempts.length], ['achievements', '🏅 الإنجازات', Object.keys(st.achievements).length]];
    const nav = $('#nav');
    nav.classList.toggle('hidden', r.name === 'quiz');
    nav.innerHTML = tabs.map(([n, l, k]) => `<a class="nav-tab ${(r.name === 'home' ? '' : r.name) === n ? 'active' : ''}" href="#/${n}">${l}${k ? `<span class="cnt">${k}</span>` : ''}</a>`).join('');
  }
  App.renderNav = () => renderNav(App.route || { name: 'home' });

  /* ---------- pages ---------- */
  function emptyState(icon, title, text, extra) {
    return `<div class="panel empty-state"><div class="big">${icon}</div><h3>${esc(title)}</h3><p>${text}</p>${extra || ''}</div>`;
  }
  function homePage() {
    const { state: st, content: c } = App, sk = C.streaks(st, Date.now());
    if (!c.lectures.length) {
      return emptyState('📭', 'لا توجد محاضرات بعد', 'لم تُضف محاضرات لهذه المادة بعد.');
    }
    const distinct = Object.keys(st.latest).length;
    const strip = `<div class="stats-strip">
      <div class="stat-pill"><b>🔥 ${sk.current}</b><span>Current Streak (أيام)</span></div>
      <div class="stat-pill"><b>🏆 ${sk.best}</b><span>Best Streak (أيام)</span></div>
      <div class="stat-pill"><b>📚 ${distinct}</b><span>أسئلة مختلفة تم حلها</span></div>
      <div class="stat-pill"><b>🎯 ${st.runs.correct}</b><span>صحيحة متتالية (الأفضل ${st.runs.best})</span></div></div>`;
    const cards = c.lectures.map((l, i) => {
      const s = C.lectureStats(st, c, l.id), sess = Object.values(st.sessions).find((x) => x.kind === 'lecture' && x.lectureId === l.id);
      const empty = !s.total;
      return `<div class="lecture-card ${empty ? 'is-empty' : ''}" ${empty ? '' : `data-act="startLecture" data-id="${esc(l.id)}"`}>
        <div class="lecture-icon">${esc(l.icon)}</div><div class="lecture-number">المحاضرة ${i + 1}</div><div class="lecture-title">${esc(l.title)}</div>
        <div class="lecture-meta">${empty ? 'لا توجد أسئلة بعد' : `${s.total} سؤال`}</div>
        ${empty ? '' : `<div class="meter" title="نسبة الأسئلة المختلفة التي حللتها"><div class="meter-row"><span>التغطية</span><b>${s.coveragePct}% (${s.answered}/${s.total})</b></div><div class="meter-track"><div class="meter-fill cov" style="width:${s.coveragePct}%"></div></div></div>
        <div class="meter" title="الأسئلة التي كانت آخر إجابة عنها صحيحة"><div class="meter-row"><span>الإتقان — ${esc(s.level)}</span><b>${s.masteryPct}% (${s.correct}/${s.total})</b></div><div class="meter-track"><div class="meter-fill mas" style="width:${s.masteryPct}%"></div></div></div>
        <div class="card-actions">${sess ? `<button class="btn primary sm" data-act="resume" data-id="${esc(sess.id)}">استكمال</button><button class="btn ghost sm" data-act="startLecture" data-id="${esc(l.id)}">جديد</button>` : `<button class="btn primary sm" data-act="startLecture" data-id="${esc(l.id)}">ابدأ الاختبار</button>`}</div>`}
      </div>`;
    }).join('');
    return strip + `<div class="lecture-grid">${cards}</div>`;
  }

  function qRow(q, snap, right) {
    const title = App.lectureTitle(q ? q.lectureId : snap.lectureId);
    return `<div class="item"><div class="grow"><div class="item-title ltr">${esc(q ? q.text : snap.text)}</div><div class="item-sub">${esc(title || 'محاضرة محذوفة')}${q ? '' : ' <span class="badge warn">محذوف من المحتوى</span>'}</div></div>${right}</div>`;
  }
  function favoritesPage() {
    const { state: st, content: c } = App, ids = C.favoriteIds(st, c), removed = Object.keys(st.favorites).filter((id) => !c.qById.has(id));
    let h = `<h2 class="page-title">⭐ المفضلة</h2>`;
    if (!ids.length && !removed.length) return h + emptyState('⭐', 'لا توجد أسئلة مفضلة', 'اضغط على ⭐ أثناء الاختبار لإضافة سؤال إلى المفضلة.');
    h += `<div class="panel"><div class="row between"><span>${ids.length} سؤال</span><button class="btn primary" data-act="startFav" ${ids.length ? '' : 'disabled'}>اختبار من المفضلة</button></div>`;
    h += ids.map((id) => qRow(c.qById.get(id), null, `<button class="btn ghost sm" data-act="unfav" data-id="${esc(id)}">إزالة</button>`)).join('') + '</div>';
    if (removed.length) h += `<div class="notice">${removed.length} مفضلة مرتبطة بأسئلة حُذفت من المحتوى. <button class="btn ghost sm" data-act="clearRemovedFav">إزالتها</button></div>`;
    return h;
  }
  function mistakesPage() {
    const { state: st, content: c } = App, act = C.activeMistakeIds(st, c);
    const resolved = c.questions.filter((q) => st.mistakes[q.id] && st.mistakes[q.id].status === 'resolved');
    const orphan = Object.keys(st.mistakes).filter((id) => !c.qById.has(id)).length;
    let h = `<h2 class="page-title">❌ بنك الأخطاء</h2>`;
    if (!act.length && !resolved.length && !orphan) return h + emptyState('🎉', 'لا توجد أخطاء مسجّلة', 'تُحفظ الأسئلة التي تجيب عنها خطأ هنا تلقائيًا لإعادة اختبارها.');
    h += `<div class="panel"><div class="row between"><span>${act.length} خطأ نشط</span><button class="btn primary" data-act="startMistakes" ${act.length ? '' : 'disabled'}>اختبار من الأخطاء</button></div>`;
    h += act.map((id) => { const m = st.mistakes[id]; return qRow(c.qById.get(id), null, `<span class="badge bad">أخطأت ${m.wrongCount}×</span>`); }).join('');
    if (!act.length) h += '<p class="page-sub" style="margin:14px 0 0">لا توجد أخطاء نشطة حاليًا 👏</p>';
    h += '</div>';
    if (resolved.length) h += `<details class="panel"><summary>✅ أخطاء تم تصحيحها (${resolved.length})</summary>${resolved.map((q) => qRow(q, null, `<span class="badge good">صُحّح ${esc(U.fmtDate(st.mistakes[q.id].resolvedAt))}</span>`)).join('')}</details>`;
    if (orphan) h += `<div class="notice">${orphan} سجل خطأ مرتبط بأسئلة حُذفت من المحتوى؛ بقيت محفوظة في سجل المحاولات.</div>`;
    return h;
  }
  function incompletePage() {
    const list = Object.values(App.state.sessions).sort((a, b) => b.updatedAt - a.updatedAt);
    let h = `<h2 class="page-title">⏸ الاختبارات غير المكتملة</h2>`;
    if (!list.length) return h + emptyState('✅', 'لا توجد اختبارات غير مكتملة', 'يُحفظ تقدمك تلقائيًا وتجده هنا إذا خرجت قبل الإنهاء.');
    return h + `<div class="panel">${list.map((s) => `<div class="item"><div class="grow"><div class="item-title">${esc(s.title)} <span class="badge">${KIND[s.kind] || s.kind}</span></div><div class="item-sub">${Object.keys(s.answers).length} / ${s.qids.length} أُجيب عنها · ${U.fmtDur(s.elapsedMs)} · آخر نشاط ${esc(U.fmtDate(s.updatedAt))}</div></div>
      <button class="btn primary sm" data-act="resume" data-id="${esc(s.id)}">استكمال</button><button class="btn danger sm" data-act="deleteSession" data-id="${esc(s.id)}">حذف</button></div>`).join('')}</div>`;
  }
  const arrow = (d, lowerBetter, fmt) => { if (!d) return '<span class="delta same">＝ بلا تغيير</span>'; const good = lowerBetter ? d < 0 : d > 0; return `<span class="delta ${good ? 'better' : 'worse'}">${good ? '▲ تحسّن' : '▼ تراجع'} (${d > 0 ? '+' : ''}${fmt(d)})</span>`; };
  function historyPage() {
    const { state: st, content: c } = App;
    let h = `<h2 class="page-title">🕘 السجل والمقارنة</h2>`;
    if (!st.attempts.length) return h + emptyState('🕘', 'لا يوجد سجل بعد', 'ستظهر هنا كل الاختبارات المكتملة بتواريخها ونتائجها.');
    const lecIds = [...new Set(st.attempts.filter((a) => a.kind === 'lecture' && a.full).map((a) => a.lectureId))];
    if (lecIds.length) {
      h += `<h3 class="page-title" style="font-size:1.2rem">أول مقابل آخر اختبار كامل</h3><div class="compare-grid">` + lecIds.map((id) => {
        const cmp = C.compareFull(st, id), title = App.lectureTitle(id) || (cmp.first && cmp.first.title) || id;
        if (!cmp.last) return `<div class="panel"><div class="item-title">${esc(title)}</div><p class="page-sub" style="margin:8px 0 0">أكمل الاختبار الكامل مرة أخرى لعرض المقارنة (مكتمل ${cmp.count} فقط).</p></div>`;
        const v = { improved: '<span class="badge good">تحسّن</span>', regressed: '<span class="badge bad">تراجع</span>', same: '<span class="badge">ثبات</span>' }[cmp.verdict];
        return `<div class="panel"><div class="row between"><div class="item-title">${esc(title)}</div>${v}</div>
          <table class="cmp-table"><tr><th></th><th>الأول</th><th>الأخير</th><th>التغيّر</th></tr>
          <tr><td>الدرجة</td><td>${cmp.first.pct}%</td><td>${cmp.last.pct}%</td><td>${arrow(cmp.dPct, false, (x) => x + '%')}</td></tr>
          <tr><td>الأخطاء</td><td>${cmp.first.wrong}</td><td>${cmp.last.wrong}</td><td>${arrow(cmp.dWrong, true, (x) => x)}</td></tr>
          <tr><td>الوقت</td><td>${U.fmtDur(cmp.first.durationMs)}</td><td>${U.fmtDur(cmp.last.durationMs)}</td><td>${arrow(cmp.dTime, true, (x) => (x < 0 ? '-' : '') + U.fmtDur(Math.abs(x)))}</td></tr></table>
          <div class="item-sub">عدد الاختبارات الكاملة: ${cmp.count}${cmp.sameTotal ? '' : ` · <span class="badge warn">تغيّر عدد الأسئلة (${cmp.first.total} ← ${cmp.last.total})</span>`}</div></div>`;
      }).join('') + '</div>';
    }
    h += `<h3 class="page-title" style="font-size:1.2rem;margin-top:24px">كل المحاولات (${st.attempts.length})</h3><div class="panel">` +
      st.attempts.slice().sort((a, b) => b.completedAt - a.completedAt).map((a) => {
        const gone = a.items.filter((i) => !c.qById.has(i.qid)).length;
        return `<a class="item" style="text-decoration:none;color:inherit" href="#/results/${esc(a.id)}"><div class="grow"><div class="item-title">${esc(a.title)} <span class="badge">${a.kind === 'lecture' ? (a.full ? 'كامل' : 'جزئي') : KIND[a.kind] || a.kind}</span>${gone ? ` <span class="badge warn">${gone} محذوف</span>` : ''}</div><div class="item-sub">${esc(U.fmtDate(a.completedAt))} · ${U.fmtDur(a.durationMs)}</div></div><div><b>${a.correct}/${a.total}</b> <span class="badge ${a.pct >= 50 ? 'good' : 'bad'}">${a.pct}%</span></div></a>`;
      }).join('') + '</div>';
    return h;
  }
  function achievementsPage() {
    const st = App.state, sk = C.streaks(st, Date.now());
    return `<h2 class="page-title">🏅 الإنجازات</h2><div class="stats-strip" style="margin-bottom:18px">
      <div class="stat-pill"><b>🔥 ${sk.current}</b><span>Current Streak</span></div><div class="stat-pill"><b>🏆 ${sk.best}</b><span>Best Streak</span></div>
      <div class="stat-pill"><b>🎯 ${st.runs.best}</b><span>أفضل سلسلة صحيحة</span></div></div><div class="achv-grid">` +
      C.ACHIEVEMENTS.map((a) => { const got = st.achievements[a.id], p = Math.min(a.progress(st), a.target);
        return `<div class="panel achv ${got ? 'earned' : 'locked'}"><div class="ic">${a.icon}</div><div class="item-title" style="text-align:center">${esc(a.title)}</div>
        <div class="meter"><div class="meter-track"><div class="meter-fill mas" style="width:${U.pct(p, a.target)}%"></div></div><div style="text-align:center;margin-top:4px">${got ? '✅ ' + esc(U.fmtDate(got.at)) : p + ' / ' + a.target}</div></div></div>`; }).join('') + '</div>';
  }

  /* ---------- actions ---------- */
  Object.assign(App.actions, {
    startLecture: (b) => QDU.Quiz.start('lecture', b.dataset.id),
    startFav: () => QDU.Quiz.start('favorites'),
    startMistakes: () => QDU.Quiz.start('mistakes'),
    resume: (b) => App.go('#/quiz/' + b.dataset.id),
    unfav: (b) => { delete App.state.favorites[b.dataset.id]; App.save(); App.render(); },
    clearRemovedFav: () => { for (const id of Object.keys(App.state.favorites)) if (!App.content.qById.has(id)) delete App.state.favorites[id]; App.save(); App.render(); },
    deleteSession: async (b) => {
      const s = App.state.sessions[b.dataset.id]; if (!s) return;
      const r = await App.dialog({ title: 'حذف الاختبار غير المكتمل؟', text: `سيتم حذف تقدمك في «${s.title}» (${Object.keys(s.answers).length} إجابة). الإجابات المحفوظة سابقًا في سجل الأخطاء والإتقان تبقى كما هي.`, buttons: [{ id: 'no', label: 'إلغاء' }, { id: 'yes', label: 'حذف', cls: 'danger' }] });
      if (r === 'yes') { delete App.state.sessions[s.id]; App.save(); App.render(); }
    }
  });

  /* ---------- router ---------- */
  function parse() {
    const p = (location.hash.replace(/^#\/?/, '') || '').split('/');
    const n = p[0];
    if (n === 'quiz' && p[1]) return { name: 'quiz', id: p[1] };
    if (n === 'results' && p[1]) return { name: 'results', id: p[1] };
    return { name: ['favorites', 'mistakes', 'incomplete', 'history', 'achievements'].includes(n) ? n : 'home' };
  }
  App.render = function () {
    QDU.Quiz.leave();
    const r = (App.route = parse()), view = $('#view');
    $('#app').dataset.page = r.name;
    renderNav(r);
    if (r.name === 'quiz') { if (!QDU.Quiz.view(r.id)) { App.go('#/'); } return; }
    if (r.name === 'results') { if (!QDU.Quiz.results(r.id)) { App.go('#/history'); } return; }
    view.innerHTML = { home: homePage, favorites: favoritesPage, mistakes: mistakesPage, incomplete: incompletePage, history: historyPage, achievements: achievementsPage }[r.name]();
    window.scrollTo(0, 0);
  };

  function showError(msg) { $('#view').innerHTML = emptyState('⚠️', 'تعذّر تحميل المحتوى', msg); }

  /* ---------- boot ---------- */
  async function boot() {
    let site = { platformTitle: 'منصة QDU للاختبار التفاعلي', dataPath: 'data/', repoId: '', protectContent: true };
    try { const r = await fetch('site.config.json', { cache: 'no-cache' }); if (r.ok) site = Object.assign(site, await r.json()); } catch (e) {}
    App.site = site;
    $('#view').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && App.actions[b.dataset.act]) { e.preventDefault(); App.actions[b.dataset.act](b); } });
    $('#input').addEventListener('change', (e) => { App.state.settings.dark = e.target.checked; applyTheme(); App.save(); });
    // social links: on phones try the native app first, fall back to the web page if the app did not take over
    document.querySelector('.site-footer').addEventListener('click', (e) => {
      const l = e.target.closest('a[data-app]');
      if (!l || !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;   // desktop: normal link in a new tab
      e.preventDefault();
      let left = false; const onVis = () => { if (document.hidden) left = true; };
      document.addEventListener('visibilitychange', onVis);
      window.location.href = l.dataset.app;
      setTimeout(() => { document.removeEventListener('visibilitychange', onVis); if (!left && !document.hidden) window.open(l.href, '_blank', 'noopener'); }, 1500);
    });
    $('#fullscreenToggle').addEventListener('click', toggleStudy);
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) $('#app').classList.remove('study-mode'); });

    let content;
    try { content = await QDU.Loader.loadContent(site.dataPath); }
    catch (e) {
      const why = e.kind === 'network' && location.protocol === 'file:' ? 'لا يمكن قراءة ملفات JSON عند فتح الصفحة مباشرة من القرص (file://). شغّل الموقع عبر خادم محلي أو GitHub Pages، مثال: <code>python -m http.server</code>'
        : e.kind === 'parse' ? 'ملف JSON غير صالح: <code>' + esc(e.url) + '</code>' : 'تعذّر الوصول إلى الملفات. تحقق من الاتصال والمسارات.';
      App.state = S.emptyState(); App.store = { save: () => false }; return showError(why);
    }
    App.content = content;
    const subj = content.subject, title = subj.platformTitle || site.platformTitle;
    $('#platformTitle').textContent = title;
    if (subj.name) { const el = $('#subjectName'); el.textContent = subj.name; el.classList.remove('hidden'); }
    if (subj.author) { $('#authorName').textContent = subj.author; $('#authorLine').classList.remove('hidden'); }
    document.title = (subj.name ? subj.name + ' — ' : '') + title;
    const store = (App.store = S.createStore(S.storageKey(S.deriveRepoId(site.repoId), subj.id)));
    App.state = store.state;
    C.reconcile(App.state, content); App.state.meta.contentVersion = subj.contentVersion; App.save();
    applyTheme();
    const notes = [];
    if (content.warnings.length) { console.warn('[QDU] data warnings:', content.warnings); notes.push(`تم تجاهل ${content.warnings.length} عنصر بسبب أخطاء في ملفات البيانات (التفاصيل في console).`); }
    if (store.readOnly) notes.push('البيانات المحفوظة أحدث من هذا الإصدار؛ لن يتم تعديلها.');
    if (!store.persistent) notes.push('التخزين المحلي غير متاح (وضع خاص؟): لن يُحفظ التقدم بعد إغلاق الصفحة.');
    if (store.recovered) notes.push('تعذّرت قراءة بيانات محفوظة تالفة؛ تم حفظ نسخة منها وبدأنا ببيانات جديدة.');
    $('#notices').innerHTML = notes.map((n) => `<div class="notice">${esc(n)}</div>`).join('');

    if (site.protectContent) QDU.Quiz.protect();
    QDU.Quiz.init();
    window.addEventListener('hashchange', App.render);
    window.addEventListener('storage', (e) => {
      if (e.key !== store.key) return;
      store.reload(); App.state = store.state; C.reconcile(App.state, content); App.render();
    });
    App.render();
  }
  QDU.boot = boot;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', boot);
})(window);
