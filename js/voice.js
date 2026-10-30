/* Manaen — voix : dictée des questions et lecture des réponses à voix haute. */
(function () {
  'use strict';
  const M = window.M;
  const N = () => window.ManaenNative;

  // Transforme une réponse Markdown en texte agréable à écouter
  function speechText(md) {
    return window.Files.blocks(md).map((b) => {
      if (b.t === 'table') return b.rows.slice(1).map((r) => r.map((c, k) => (b.rows[0][k] ? b.rows[0][k] + ' : ' : '') + c).join(', ')).join('. ');
      return b.t === 'code' ? '' : b.text;
    }).join('.\n')
      .replace(/\*\*|__|`|~~|#+\s/g, '').replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[🧠🔗⚠️✔✖👋💡📊📝📄]/gu, '')
      .replace(/\.\.+/g, '.').replace(/\s*\.\s*\./g, '.')
      .replace(/ → /g, ', puis ').replace(/≈/g, 'environ ').replace(/×/g, ' fois ').replace(/ \/ /g, ' divisé par ')
      .replace(/(\d),(\d)/g, '$1 virgule $2');
  }

  // ---------------- Lecture à voix haute ----------------
  let onEnd = null;
  window.__onSpeakEnd = () => { const f = onEnd; onEnd = null; if (f) f(); };

  function stop() {
    onEnd = null;
    if (N()) N().stopSpeak();
    else if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  // Renvoie false si aucune voix n'est disponible
  function speak(md, whenDone) {
    stop();
    const txt = speechText(md);
    if (!txt.trim()) return false;
    if (N()) {
      if (N().canSpeak && !N().canSpeak()) return false;
      onEnd = whenDone;
      N().speak(txt);
      return true;
    }
    if (!window.speechSynthesis) return false;
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = 'fr-FR';
    const fr = window.speechSynthesis.getVoices().filter((v) => /^fr/i.test(v.lang));
    const best = fr.find((v) => /natural|online|google|neural/i.test(v.name)) || fr[0];
    if (best) u.voice = best;
    onEnd = whenDone;
    u.onend = () => window.__onSpeakEnd();
    window.speechSynthesis.speak(u);
    return true;
  }

  // ---------------- Dictée ----------------
  // whenDone(texte | null, erreur?)
  let pendingDictation = null;
  window.__onVoice = (text, err) => { const f = pendingDictation; pendingDictation = null; if (f) f(text, err); };

  function listen(whenDone) {
    stop();
    pendingDictation = whenDone;
    if (N()) { N().startVoice(); return true; }
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) { pendingDictation = null; return false; }
    const r = new R();
    r.lang = 'fr-FR';
    r.interimResults = false;
    r.onresult = (e) => window.__onVoice(e.results[0][0].transcript);
    r.onerror = () => window.__onVoice(null);
    r.onend = () => window.__onVoice(null); // sans effet si un résultat est déjà arrivé
    r.start();
    return true;
  }

  M.voice = { speak, stop, listen, speechText };
})();
