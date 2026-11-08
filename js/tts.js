/* Text-to-speech wrapper (Web Speech API). Never auto-starts. Handles missing voices. */
(function (g) {
  const QDU = (g.QDU = g.QDU || {});
  const FEMALE = /female|woman|zira|hazel|susan|samantha|victoria|karen|moira|tessa|fiona|allison|ava\b|serena|kate|jenny|aria|sonia|libby|emma|joanna|salli|kendra|kimberly|ivy|amy|nicole|laila|salma|hoda|zariyah|mariam|noura|google uk english female|google us english/i;
  const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
  let voices = [], token = 0, playing = false;
  const synth = () => (g.speechSynthesis || null);
  const supported = () => !!(synth() && g.SpeechSynthesisUtterance);

  function refresh() { if (supported()) voices = synth().getVoices() || []; return voices; }
  if (supported()) { refresh(); try { synth().addEventListener('voiceschanged', refresh); } catch (e) { synth().onvoiceschanged = refresh; } }

  function voicesFor(lang) { refresh(); return voices.filter((v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith(lang)); }
  function pickVoice(lang, pref) {
    const list = voicesFor(lang);
    if (pref) { const f = list.find((v) => v.voiceURI === pref || v.name === pref); if (f) return f; }
    const fem = list.filter((v) => FEMALE.test(v.name));
    return fem.find((v) => /en[-_]gb/i.test(v.lang)) || fem[0] || list.find((v) => v.default) || list[0] || null;
  }

  // segments: [{text, lang:'en'|'ar'}]; opts: {voices:{en,ar}, rate, onEnd}
  function speak(segments, opts) {
    if (!supported()) return { ok: false, reason: 'unsupported' };
    const segs = segments.filter((s) => s.text && s.text.trim());
    if (!segs.length) return { ok: false, reason: 'empty' };
    const needAr = segs.some((s) => s.lang === 'ar');
    if (needAr && !pickVoice('ar', opts.voices && opts.voices.ar)) return { ok: false, reason: 'novoice-ar' };
    stop();
    const my = ++token; playing = true;
    let i = 0;
    const next = () => {
      if (my !== token) return;
      if (i >= segs.length) { playing = false; opts.onEnd && opts.onEnd(); return; }
      const s = segs[i++];
      const u = new g.SpeechSynthesisUtterance(s.text);
      u.lang = s.lang === 'ar' ? 'ar-SA' : 'en-US';
      const v = pickVoice(s.lang, opts.voices && opts.voices[s.lang]);
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = opts.rate || 1;
      u.onend = next;
      u.onerror = () => { if (my === token) { playing = false; opts.onEnd && opts.onEnd(); } };
      synth().speak(u);
    };
    next();
    return { ok: true };
  }
  function stop() { token++; playing = false; if (supported()) synth().cancel(); }

  QDU.TTS = { supported, voicesFor, pickVoice, speak, stop, isPlaying: () => playing, ordinal: (i) => ORD[i] || String(i + 1), refresh };
  if (typeof module !== 'undefined') module.exports = QDU.TTS;
})(typeof window !== 'undefined' ? window : globalThis);
