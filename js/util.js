/* QDU utilities (shared by browser and node tests) */
(function (g) {
  const QDU = (g.QDU = g.QDU || {});
  const pad = (n) => String(n).padStart(2, '0');
  QDU.util = {
    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    uid(prefix) { return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
    dayKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); },
    dayNum(key) { const [y, m, d] = key.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); },
    fmtDur(ms) {
      const s = Math.max(0, Math.round((ms || 0) / 1000));
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      return (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(sec);
    },
    fmtDate(ts) {
      try { return new Date(ts).toLocaleString('ar-IQ-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }); }
      catch (e) { return new Date(ts).toLocaleString(); }
    },
    letter(i) { return i < 26 ? String.fromCharCode(65 + i) : String(i + 1); },
    pct(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; }
  };
  if (typeof module !== 'undefined') module.exports = QDU;
})(typeof window !== 'undefined' ? window : globalThis);
