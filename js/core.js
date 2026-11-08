/* QDU core: scoring, mistakes, streaks, achievements, comparison. Pure functions over (state, content). */
(function (g) {
  const QDU = (g.QDU = g.QDU || {});
  const U = QDU.util || require('./util.js').util;

  const MAX_HINTS = 3;
  const ACHIEVEMENTS = [
    { id: 'distinct100', icon: '📚', title: 'حل 100 سؤال مختلف', target: 100, progress: (s) => Object.keys(s.latest).length },
    { id: 'attempts10', icon: '📝', title: 'إكمال 10 اختبارات', target: 10, progress: (s) => s.attempts.length },
    { id: 'run100', icon: '🎯', title: '100 إجابة صحيحة متتالية', target: 100, progress: (s) => s.runs.best },
    { id: 'perfect', icon: '💯', title: 'الدرجة الكاملة', target: 1, progress: (s) => (s.attempts.some((a) => a.total > 0 && a.correct === a.total) ? 1 : 0) },
    { id: 'consistency7', icon: '🔥', title: 'الاستمرارية: 7 أيام متتالية', target: 7, progress: (s) => streaks(s, Date.now()).best }
  ];

  function streaks(state, now) {
    const days = Array.from(new Set(state.activity.days)).sort();
    let best = 0, run = 0, prev = null;
    for (const d of days) { const n = U.dayNum(d); run = prev !== null && n === prev + 1 ? run + 1 : 1; prev = n; if (run > best) best = run; }
    let current = 0;
    if (days.length) {
      const last = U.dayNum(days[days.length - 1]), today = U.dayNum(U.dayKey(now));
      if (today - last <= 1) current = run; // still alive if last active day is today or yesterday
    }
    return { current, best: Math.max(best, state.activity.bestStreak || 0) };
  }

  function addActivity(state, ts) {
    const k = U.dayKey(ts);
    if (!state.activity.days.includes(k)) { state.activity.days.push(k); state.activity.days.sort(); }
    state.activity.bestStreak = streaks(state, ts).best;
  }

  function evaluateAchievements(state, ts) {
    const granted = [];
    for (const a of ACHIEVEMENTS) {
      if (!state.achievements[a.id] && a.progress(state) >= a.target) { state.achievements[a.id] = { at: ts }; granted.push(a); }
    }
    return granted;
  }

  function level(pct, answered) {
    if (!answered) return 'لم يبدأ';
    return pct < 40 ? 'مبتدئ' : pct < 70 ? 'متوسط' : pct < 90 ? 'جيد' : 'متقن';
  }

  // coverage = distinct questions ever answered / total; mastery = questions whose LAST answer is correct / total
  function lectureStats(state, content, lectureId) {
    const qs = content.byLecture.get(lectureId) || [];
    let answered = 0, correct = 0;
    for (const q of qs) { const l = state.latest[q.id]; if (l) { answered++; if (l.isCorrect) correct++; } }
    const total = qs.length, masteryPct = U.pct(correct, total);
    return { total, answered, correct, coveragePct: U.pct(answered, total), masteryPct, level: level(masteryPct, answered) };
  }

  function activeMistakeIds(state, content) {
    return content.questions.filter((q) => state.mistakes[q.id] && state.mistakes[q.id].status === 'active').map((q) => q.id);
  }
  function favoriteIds(state, content) { return content.questions.filter((q) => state.favorites[q.id]).map((q) => q.id); }

  function toggleFavorite(state, q, ts) {
    if (state.favorites[q.id]) { delete state.favorites[q.id]; return false; }
    state.favorites[q.id] = { at: ts, text: q.text, lectureId: q.lectureId };
    return true;
  }

  function newSession(content, kind, lectureId, qids, ts, title) {
    return { id: U.uid('s'), kind, lectureId: lectureId == null ? null : lectureId, title, qids: qids.slice(),
      fullSet: kind === 'lecture' && qids.length === (content.byLecture.get(lectureId) || []).length,
      answers: {}, hints: {}, hintsUsed: 0, idx: 0, elapsedMs: 0, startedAt: ts, updatedAt: ts };
  }

  // Records one answer. A question in a session can be answered only once (no double scoring on back/forward).
  function recordAnswer(state, content, session, qid, choice, ts) {
    if (session.answers[qid]) return { ok: false, reason: 'duplicate' };
    const q = content.qById.get(qid);
    if (!q) return { ok: false, reason: 'missing' };
    if (!session.qids.includes(qid)) return { ok: false, reason: 'notInSession' };
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return { ok: false, reason: 'range' };
    if (((session.hints || {})[qid] || []).includes(choice)) return { ok: false, reason: 'removed' };
    const isCorrect = choice === q.correct;
    session.answers[qid] = { choice, isCorrect, at: ts };
    session.updatedAt = ts;
    state.latest[qid] = { choice, isCorrect, at: ts, sessionId: session.id };
    let m = state.mistakes[qid];
    if (isCorrect) {
      if (m && m.status === 'active') { m.status = 'resolved'; m.resolvedAt = ts; }
      state.runs.correct++; if (state.runs.correct > state.runs.best) state.runs.best = state.runs.correct;
    } else {
      if (!m) m = state.mistakes[qid] = { firstAt: ts, wrongCount: 0 };
      m.status = 'active'; m.wrongCount = (m.wrongCount || 0) + 1; m.lastAt = ts; delete m.resolvedAt;
      m.text = q.text; m.lectureId = q.lectureId;
      state.runs.correct = 0;
    }
    addActivity(state, ts);
    return { ok: true, isCorrect, newAchievements: evaluateAchievements(state, ts) };
  }

  // Hint = removes up to two WRONG options (never the correct one), max MAX_HINTS per quiz session, once per question.
  function useHint(session, q, rnd) {
    session.hints = session.hints || {}; session.hintsUsed = session.hintsUsed || 0;
    if (session.answers[q.id]) return { ok: false, reason: 'answered' };
    if (session.hints[q.id]) return { ok: false, reason: 'used' };
    if (session.hintsUsed >= MAX_HINTS) return { ok: false, reason: 'exhausted' };
    const wrong = q.options.map((_, i) => i).filter((i) => i !== q.correct);
    const count = Math.min(2, wrong.length - 1);
    if (count < 1) return { ok: false, reason: 'toofew' };
    const r = rnd || Math.random, pool = wrong.slice(), removed = [];
    while (removed.length < count) removed.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    session.hints[q.id] = removed.sort((a, b) => a - b); session.hintsUsed++;
    return { ok: true, removed: session.hints[q.id], left: MAX_HINTS - session.hintsUsed };
  }

  // Completes a session into a permanent attempt. Idempotent: the attempt id derives from the session id.
  function finalizeSession(state, content, session, ts) {
    const id = 'a_' + session.id;
    const existing = state.attempts.find((a) => a.id === id);
    if (existing) { delete state.sessions[session.id]; return { attempt: existing, newAchievements: [], duplicate: true }; }
    const items = session.qids.filter((qid) => session.answers[qid]).map((qid) => {
      const q = content.qById.get(qid), a = session.answers[qid];
      const en = content.enrichment.get(qid);
      return { qid, lectureId: q ? q.lectureId : null, text: q ? q.text : '', options: q ? q.options.slice() : [],
        correct: q ? q.correct : -1, choice: a.choice, isCorrect: a.isCorrect, explanation: (en && en.explanation) || '' };
    });
    const correct = items.filter((i) => i.isCorrect).length, total = items.length;
    const lec = content.lectureById.get(session.lectureId);
    const attempt = {
      id, sessionId: session.id, kind: session.kind, lectureId: session.lectureId, title: session.title,
      startedAt: session.startedAt, completedAt: ts, durationMs: session.elapsedMs || 0,
      correct, wrong: total - correct, total, pct: U.pct(correct, total),
      full: session.kind === 'lecture' && !!session.fullSet && !!lec && total === (content.byLecture.get(session.lectureId) || []).length,
      hintsUsed: session.hintsUsed || 0, celebrated: false, items
    };
    state.attempts.push(attempt);
    delete state.sessions[session.id];
    addActivity(state, ts);
    return { attempt, newAchievements: evaluateAchievements(state, ts), duplicate: false };
  }

  // first vs last COMPLETE lecture attempt only (custom quizzes and partial sets never enter the comparison)
  function compareFull(state, lectureId) {
    const list = state.attempts.filter((a) => a.kind === 'lecture' && a.lectureId === lectureId && a.full).sort((a, b) => a.completedAt - b.completedAt);
    if (list.length < 2) return { count: list.length, first: list[0] || null, last: null };
    const first = list[0], last = list[list.length - 1];
    const dPct = Math.round((last.pct - first.pct) * 10) / 10;
    return { count: list.length, first, last, dPct, dWrong: last.wrong - first.wrong, dTime: last.durationMs - first.durationMs,
      sameTotal: first.total === last.total, verdict: dPct > 0 ? 'improved' : dPct < 0 ? 'regressed' : 'same' };
  }

  // Reconcile live progress and unfinished sessions with the current answer key.
  function reconcile(state, content) {
    for (const q of content.questions) {
      const latest = state.latest[q.id];
      if (!latest || latest.isCorrect === (latest.choice === q.correct)) continue;
      latest.isCorrect = latest.choice === q.correct;
      const mistake = state.mistakes[q.id];
      if (latest.isCorrect) {
        if (mistake) { mistake.status = 'resolved'; mistake.resolvedAt = latest.at; }
      } else {
        const active = state.mistakes[q.id] = mistake || { firstAt: latest.at, wrongCount: 0 };
        active.status = 'active'; active.lastAt = latest.at;
        active.wrongCount = Math.max(active.wrongCount || 0, 1);
        active.text = q.text; active.lectureId = q.lectureId;
        delete active.resolvedAt;
      }
    }
    for (const [id, s] of Object.entries(state.sessions)) {
      s.qids = s.qids.filter((q) => content.qById.has(q));
      for (const k of Object.keys(s.answers)) {
        const q = content.qById.get(k);
        if (!q) delete s.answers[k];
        else s.answers[k].isCorrect = s.answers[k].choice === q.correct;
      }
      if (!s.qids.length) { delete state.sessions[id]; continue; }
      s.hints = s.hints || {}; s.hintsUsed = s.hintsUsed || 0;
      for (const qid of s.qids) {
        if (s.hints[qid]) s.hints[qid] = s.hints[qid].filter((choice) => choice !== content.qById.get(qid).correct);
      }
      s.idx = Math.min(Math.max(0, s.idx | 0), s.qids.length - 1);
    }
  }

  function rating(pct) {
    if (pct >= 100) return { key: 'perfect', label: '🏆 درجة كاملة', cls: 'badge-excellent', msg: 'درجة كاملة! أداء مذهل 🌟' };
    if (pct >= 90) return { key: 'excellent', label: '🌟 متفوق', cls: 'badge-excellent', msg: 'ممتاز! أداء رائع ومتميز 🌟' };
    if (pct >= 50) return { key: 'pass', label: '✅ ناجح', cls: 'badge-pass', msg: 'أحسنت! أداء جيد، واصل التقدم 👏' };
    return { key: 'fail', label: '❌ راسب', cls: 'badge-fail', msg: 'حاول مرة أخرى! التعلم يحتاج للممارسة المستمرة 💪' };
  }

  QDU.core = { MAX_HINTS, useHint, ACHIEVEMENTS, streaks, addActivity, evaluateAchievements, lectureStats, activeMistakeIds, favoriteIds, toggleFavorite,
    newSession, recordAnswer, finalizeSession, compareFull, reconcile, rating, level };
  if (typeof module !== 'undefined') module.exports = QDU.core;
})(typeof window !== 'undefined' ? window : globalThis);
