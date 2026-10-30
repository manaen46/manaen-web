/* Manaen — appels au cerveau (API Claude), avec messages d'erreur compréhensibles. */
(function () {
  'use strict';
  const M = window.M;
  const { uid, sleep } = M.util;
  const { Settings } = M.store;
  const CFG = M.config;

  class ApiError extends Error {
    constructor(msg, status, type) { super(msg); this.status = status; this.type = type; }
  }

  // Dans l'appli Android, la requête part par le code Java (pas de restriction du navigateur).
  const pending = {};
  window.__nativeResp = function (id, status, text) {
    const done = pending[id];
    if (!done) return;
    delete pending[id];
    done({ status, text });
  };

  function post(headers, body) {
    if (window.ManaenNative) {
      return new Promise((resolve) => {
        const id = uid();
        pending[id] = resolve;
        window.ManaenNative.request(id, CFG.apiUrl, JSON.stringify(headers), body);
      });
    }
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    return fetch(CFG.apiUrl, { method: 'POST', headers, body })
      .then((r) => r.text().then((text) => ({ status: r.status, text })))
      .catch((e) => ({ status: -1, text: String((e && e.message) || e) }));
  }

  function explain(status, data, raw) {
    const type = data && data.error && data.error.type;
    const m = (data && data.error && data.error.message) || raw || '';
    if (status === -1) return 'Pas de connexion à Internet (ou serveur injoignable).';
    if (status === 401) return 'La clé API est refusée. Vérifie-la dans Réglages.';
    if (status === 403) return 'Accès refusé par Anthropic pour cette clé (' + m + ').';
    if (status === 429) return 'Trop de demandes d\'un coup. Attends une minute et réessaie.';
    if (status === 529 || type === 'overloaded_error') return 'Les serveurs de Claude sont surchargés. Réessaie dans un instant.';
    if (/credit balance/i.test(m)) return 'Ton crédit Anthropic est épuisé. Recharge-le sur console.anthropic.com (menu Billing).';
    if (status === 413) return 'Le fichier envoyé est trop gros.';
    if (status === 400) return 'Demande refusée : ' + m;
    return 'Erreur ' + status + ' : ' + m;
  }

  // Envoie une demande au cerveau ; réessaie tout seul si les serveurs sont surchargés.
  async function call(body, opts) {
    if (!Settings.key) throw new ApiError('Ajoute ta clé API dans Réglages.', 401);
    const headers = { 'content-type': 'application/json', 'x-api-key': Settings.key, 'anthropic-version': CFG.apiVersion };
    const payload = JSON.stringify(body);
    for (let attempt = 0; ; attempt++) {
      const r = await post(Object.assign({}, headers), payload);
      let data = null;
      try { data = JSON.parse(r.text); } catch (e) { /* pas du JSON */ }
      if (r.status >= 200 && r.status < 300 && data) {
        Settings.trackUsage(body.model, data.usage);
        return data;
      }
      const busy = [500, 503, 529, -1].includes(r.status) || (data && data.error && data.error.type === 'overloaded_error');
      if (busy && attempt < 2 && !(opts && opts.noRetry)) {
        await sleep(2500 * (attempt + 1));
        continue;
      }
      throw new ApiError(explain(r.status, data, r.text), r.status, data && data.error && data.error.type);
    }
  }

  const textOf = (res) => res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');

  // Vérifie une clé avec une toute petite demande
  async function testKey(key) {
    const old = Settings.data.apiKey;
    Settings.data.apiKey = key;
    try {
      await call({ model: CFG.fastModel, max_tokens: 5, messages: [{ role: 'user', content: 'Réponds juste : ok' }] }, { noRetry: true });
      Settings.save();
      return { ok: true };
    } catch (e) {
      if (e.status === 401 || e.status === 403) Settings.data.apiKey = old; // clé refusée : on ne la garde pas
      else Settings.save();                                                  // réseau ou crédit : la clé est bonne
      return { ok: false, message: e.message };
    }
  }

  M.api = { call, textOf, testKey, ApiError };
})();
