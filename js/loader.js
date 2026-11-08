/* Loads and validates subject/lectures/questions/enrichment JSON. Relative paths only. */
(function (g) {
  const QDU = (g.QDU = g.QDU || {});

  async function fetchJSON(url, fetchFn) {
    let r;
    try { r = await fetchFn(url, { cache: 'no-cache' }); }
    catch (e) { const err = new Error('network'); err.kind = 'network'; err.url = url; throw err; }
    if (r.status === 404) return { missing: true };
    if (!r.ok) { const err = new Error('http ' + r.status); err.kind = 'http'; err.url = url; throw err; }
    try { return { data: await r.json() }; }
    catch (e) { const err = new Error('parse'); err.kind = 'parse'; err.url = url; throw err; }
  }

  async function loadContent(basePath, fetchFn) {
    fetchFn = fetchFn || g.fetch.bind(g);
    const base = basePath.endsWith('/') ? basePath : basePath + '/';
    const warnings = [];
    const get = async (name) => (await fetchJSON(base + name, fetchFn)).data;

    const rawSubject = (await get('subject.json')) || {};
    const rawLectures = (await get('lectures.json')) || [];
    const rawQuestions = (await get('questions.json')) || [];
    const subject = {
      id: String(rawSubject.id || '').trim(), name: String(rawSubject.name || '').trim(),
      platformTitle: String(rawSubject.platformTitle || '').trim(), author: String(rawSubject.author || '').trim(),
      contentVersion: String(rawSubject.contentVersion || '1')
    };

    const lectures = [], lectureById = new Map();
    for (const l of Array.isArray(rawLectures) ? rawLectures : rawLectures.lectures || []) {
      if (!l || l.id == null || !String(l.title || '').trim()) { warnings.push('محاضرة بلا id أو عنوان تم تجاهلها'); continue; }
      const id = String(l.id);
      if (lectureById.has(id)) { warnings.push('معرّف محاضرة مكرر: ' + id); continue; }
      const lec = { id, title: String(l.title), icon: l.icon || '📘', order: Number.isFinite(l.order) ? l.order : null, number: l.number != null && String(l.number).trim() ? String(l.number).trim() : null };
      lectureById.set(id, lec); lectures.push(lec);
    }
    lectures.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || lectures.indexOf(a) - lectures.indexOf(b));

    const questions = [], qById = new Map(), byLecture = new Map(lectures.map((l) => [l.id, []]));
    for (const q of Array.isArray(rawQuestions) ? rawQuestions : rawQuestions.questions || []) {
      const id = q && q.id != null ? String(q.id) : '';
      const opts = q && Array.isArray(q.options) ? q.options.map((o) => String(o && o.text != null ? o.text : o)) : [];
      if (!id) { warnings.push('سؤال بلا id تم تجاهله'); continue; }
      if (qById.has(id)) { warnings.push('معرّف سؤال مكرر: ' + id); continue; }
      if (!String(q.text || '').trim() || opts.length < 2) { warnings.push('سؤال غير صالح: ' + id); continue; }
      if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= opts.length) { warnings.push('رقم الإجابة الصحيحة خارج المدى: ' + id); continue; }
      if (!lectureById.has(String(q.lectureId))) { warnings.push('سؤال بمحاضرة غير موجودة: ' + id); continue; }
      const item = { id, lectureId: String(q.lectureId), text: String(q.text), options: opts, correct: q.correct };
      questions.push(item); qById.set(id, item); byLecture.get(item.lectureId).push(item);
    }

    const enrichment = new Map();
    const files = Array.isArray(rawSubject.enrichmentFiles) && rawSubject.enrichmentFiles.length ? rawSubject.enrichmentFiles : ['enrichment.json'];
    for (const f of files) {
      let res;
      try { res = await fetchJSON(base + f, fetchFn); } catch (e) { if (e.kind === 'network') throw e; warnings.push('تعذّر قراءة ملف التعليم: ' + f); continue; }
      if (res.missing) continue;
      const items = (res.data && res.data.items) || res.data || {};
      for (const [qid, v] of Object.entries(items)) {
        if (qid === 'meta' || !v || typeof v !== 'object') continue;
        enrichment.set(qid, Object.assign({}, enrichment.get(qid) || {}, v));
      }
    }
    return { subject, lectures, lectureById, questions, qById, byLecture, enrichment, warnings };
  }

  QDU.Loader = { loadContent };
  if (typeof module !== 'undefined') module.exports = QDU.Loader;
})(typeof window !== 'undefined' ? window : globalThis);
