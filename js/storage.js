/* Versioned localStorage store, namespaced per repository + subject (+ demo). */
(function (g) {
  const QDU = (g.QDU = g.QDU || {});
  const SCHEMA = 1;

  function emptyState() {
    return {
      settings: { dark: false, translate: 'off', tts: { scope: 'question', lang: 'en', voice: '', rate: 1 } },
      sessions: {},      // unfinished quizzes (auto-saved)
      attempts: [],      // permanent history of completed attempts (never deleted)
      latest: {},        // qid -> last saved answer
      favorites: {},     // qid -> {at, text, lectureId}
      mistakes: {},      // qid -> {status:'active'|'resolved', wrongCount, ...}
      achievements: {},  // id -> {at}
      activity: { days: [], bestStreak: 0 },
      runs: { correct: 0, best: 0 },
      meta: { created: Date.now(), contentVersion: null }
    };
  }
  // migrations[n] upgrades a state from schema n to n+1
  const migrations = {};

  function withDefaults(s) {
    const d = emptyState();
    for (const k of Object.keys(d)) if (s[k] == null) s[k] = d[k];
    s.settings = Object.assign({}, d.settings, s.settings);
    s.settings.tts = Object.assign({}, d.settings.tts, s.settings.tts);
    s.activity = Object.assign({}, d.activity, s.activity);
    s.runs = Object.assign({}, d.runs, s.runs);
    return s;
  }

  function storageKey(repoId, subjectId, demo) {
    return 'qdu::' + (repoId || 'local') + '::' + (demo ? 'demo::' : '') + (subjectId || 'unset');
  }
  function deriveRepoId(configured) {
    if (configured) return configured;
    if (typeof location === 'undefined') return 'local';
    const first = (location.pathname.split('/')[1] || '').replace(/\.html?$/, '');
    return location.host + '/' + first;
  }

  function createStore(key, backend) {
    let ls = backend || null;
    const store = { key, persistent: true, readOnly: false, recovered: false, lastError: null, state: null };
    if (!ls) {
      try { ls = g.localStorage; ls.setItem('__qdu_t', '1'); ls.removeItem('__qdu_t'); } catch (e) { ls = null; }
    }
    if (!ls) store.persistent = false;
    let memRaw = null;

    function read() {
      const raw = ls ? ls.getItem(key) : memRaw;
      if (!raw) return withDefaults(emptyState());
      let parsed;
      try { parsed = JSON.parse(raw); if (!parsed || typeof parsed.state !== 'object') throw new Error('bad'); }
      catch (e) {
        try { ls && ls.setItem(key + '.corrupt.' + Date.now(), raw); } catch (_) {}
        store.recovered = true;
        return withDefaults(emptyState());
      }
      let v = parsed.schema || 1, s = parsed.state;
      if (v > SCHEMA) { store.readOnly = true; return withDefaults(s); }  // written by a newer version: never overwrite
      while (v < SCHEMA) { if (migrations[v]) s = migrations[v](s) || s; v++; }
      return withDefaults(s);
    }
    store.reload = function () { store.state = read(); return store.state; };
    store.save = function () {
      if (store.readOnly) return false;
      const payload = JSON.stringify({ schema: SCHEMA, savedAt: Date.now(), state: store.state });
      try { if (ls) ls.setItem(key, payload); else memRaw = payload; store.lastError = null; return true; }
      catch (e) { store.lastError = e; return false; }
    };
    store.reload();
    return store;
  }

  QDU.Storage = { SCHEMA, emptyState, createStore, storageKey, deriveRepoId, withDefaults, migrations };
  if (typeof module !== 'undefined') module.exports = QDU.Storage;
})(typeof window !== 'undefined' ? window : globalThis);
