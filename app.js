/* Manaen — assistant pro de Franck (génie climatique, plomberie, bâtiment, enseignement) */
(function () {
  'use strict';

  // ============================================================
  //  Constantes
  // ============================================================
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const API_VERSION = '2023-06-01';
  const FAST_MODEL = 'claude-haiku-5-5';
  const MODELS = [
    { id: 'claude-sonnet-5-5', name: 'Équilibré', desc: 'Le meilleur rapport qualité/prix. Recommandé.' },
    { id: 'claude-haiku-5-5', name: 'Rapide', desc: 'Très rapide et le moins cher, pour les questions simples.' },
    { id: 'claude-opus-5-5', name: 'Expert', desc: 'Le plus fort pour les cas difficiles, plus cher.' }
  ];
  const CATS = ['Moi', 'Chantiers', 'Technique', 'Enseignement', 'Divers'];
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

  const SEED_MEMORY = [
    ['Je m\'appelle Franck.', 'Moi'],
    ['J\'ai 24 ans d\'expérience en génie climatique / CVC (chauffage, ventilation, climatisation).', 'Moi'],
    ['Je fais des chantiers et des mises en service, notamment de systèmes VRV Daikin.', 'Chantiers'],
    ['Je prépare le CAPLP pour enseigner le génie climatique (option équipements techniques-énergie).', 'Enseignement'],
    ['Je prépare des cours pour le bac pro MEE et des formations bac pro / CAP en climatisation et chauffage.', 'Enseignement'],
    ['J\'habite à Bapaume, dans les Hauts-de-France.', 'Moi']
  ];

  const SUGGESTIONS = [
    ['Dépannage', 'Un VRV Daikin affiche le code U4 : causes possibles et méthode de diagnostic ?'],
    ['Calcul', 'Comment calculer la charge complémentaire de R32 pour 25 m de liaison en 3/8 – 5/8 ?'],
    ['Cours', 'Prépare une séance de 2 h pour des 1re bac pro sur le cycle frigorifique, avec une activité élèves.'],
    ['Réglementation', 'Quelles sont les obligations de contrôle d\'étanchéité selon la charge en tonnes équivalent CO₂ ?']
  ];

  // ============================================================
  //  Outils généraux
  // ============================================================
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => window.MD.esc(String(s == null ? '' : s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isNative = () => !!window.ManaenNative;
  const isDesktop = () => !isNative() && window.matchMedia && window.matchMedia('(pointer: fine)').matches;

  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    if (html != null) e.innerHTML = html;
    return e;
  }

  let toastTimer;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2400);
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return 'aujourd\'hui ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  }

  function fmtNum(n) { return Math.round(n).toLocaleString('fr-FR'); }

  // ============================================================
  //  Stockage : IndexedDB (gros volumes) + localStorage (réglages)
  // ============================================================
  const DB = (function () {
    let dbp;
    function open() {
      if (!dbp) {
        dbp = new Promise((res, rej) => {
          const r = indexedDB.open('manaen', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      }
      return dbp;
    }
    function tx(mode, fn) {
      return open().then((db) => new Promise((res, rej) => {
        const t = db.transaction('kv', mode);
        const st = t.objectStore('kv');
        const out = fn(st);
        t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      }));
    }
    return {
      get: (k) => tx('readonly', (s) => s.get(k)),
      set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
      del: (k) => tx('readwrite', (s) => s.delete(k)),
      keys: () => tx('readonly', (s) => s.getAllKeys()),
      clear: () => tx('readwrite', (s) => s.clear())
    };
  })();

  const Settings = {
    data: {},
    load() {
      try { this.data = JSON.parse(localStorage.getItem('manaen.settings') || '{}'); } catch (e) { this.data = {}; }
      const d = this.data;
      if (!d.model) d.model = MODELS[0].id;
      if (d.autoMemory === undefined) d.autoMemory = true;
      if (d.webSearch === undefined) d.webSearch = false;
      if (d.voiceAutoSend === undefined) d.voiceAutoSend = true;
      if (d.voiceRead === undefined) d.voiceRead = true;
      if (d.consignes === undefined) d.consignes = '';
      if (!d.usage) d.usage = {};
    },
    save() { try { localStorage.setItem('manaen.settings', JSON.stringify(this.data)); } catch (e) { /* plein */ } },
    get key() { return (this.data.apiKey || '').trim(); }
  };

  // ============================================================
  //  Appels réseau vers Claude
  // ============================================================
  const pending = {};
  window.__nativeResp = function (id, code, text) {
    const p = pending[id];
    if (!p) return;
    delete pending[id];
    p({ status: code, text: text });
  };

  function rawPost(url, headers, body) {
    if (isNative()) {
      return new Promise((resolve) => {
        const id = uid();
        pending[id] = resolve;
        window.ManaenNative.request(id, url, JSON.stringify(headers), body);
      });
    }
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    return fetch(url, { method: 'POST', headers: headers, body: body })
      .then((r) => r.text().then((t) => ({ status: r.status, text: t })))
      .catch((e) => ({ status: -1, text: String(e && e.message || e) }));
  }

  class ApiError extends Error {
    constructor(msg, status, type) { super(msg); this.status = status; this.type = type; }
  }

  function explainError(status, data, raw) {
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

  async function callClaude(body, opts) {
    opts = opts || {};
    if (!Settings.key) throw new ApiError('Ajoute ta clé API dans Réglages.', 401);
    const headers = {
      'content-type': 'application/json',
      'x-api-key': Settings.key,
      'anthropic-version': API_VERSION
    };
    const payload = JSON.stringify(body);
    let attempt = 0;
    while (true) {
      const r = await rawPost(API_URL, headers, payload);
      let data = null;
      try { data = JSON.parse(r.text); } catch (e) { /* pas du JSON */ }
      if (r.status >= 200 && r.status < 300 && data) {
        trackUsage(body.model, data.usage);
        return data;
      }
      const retryable = r.status === 529 || r.status === 503 || r.status === 500 || r.status === -1 ||
        (data && data.error && data.error.type === 'overloaded_error');
      if (retryable && attempt < 2 && !opts.noRetry) {
        attempt++;
        await sleep(2500 * attempt);
        continue;
      }
      throw new ApiError(explainError(r.status, data, r.text), r.status, data && data.error && data.error.type);
    }
  }

  function trackUsage(model, u) {
    if (!u) return;
    const month = new Date().toISOString().slice(0, 7);
    const all = Settings.data.usage;
    if (!all[month]) all[month] = {};
    const m = all[month][model] || (all[month][model] = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, calls: 0, web: 0 });
    m.in += u.input_tokens || 0;
    m.out += u.output_tokens || 0;
    m.cacheRead += u.cache_read_input_tokens || 0;
    m.cacheWrite += u.cache_creation_input_tokens || 0;
    m.calls += 1;
    if (u.server_tool_use && u.server_tool_use.web_search_requests) m.web += u.server_tool_use.web_search_requests;
    Settings.save();
  }

  // ============================================================
  //  Mémoire
  // ============================================================
  const Memory = {
    items: [],
    async load() {
      const v = await DB.get('memory');
      if (Array.isArray(v)) this.items = v;
      else {
        this.items = SEED_MEMORY.map(([t, c], i) => ({ id: 'm' + (i + 1), text: t, cat: c, src: 'moi', ts: Date.now() }));
        await this.save();
      }
    },
    save() { return DB.set('memory', this.items); },
    nextId() {
      let max = 0;
      this.items.forEach((m) => { const n = parseInt(String(m.id).slice(1), 10); if (n > max) max = n; });
      return 'm' + (max + 1);
    },
    async add(text, cat, src) {
      text = String(text || '').trim();
      if (!text) return null;
      const dup = this.items.find((m) => norm(m.text) === norm(text));
      if (dup) return dup;
      const it = { id: this.nextId(), text: text, cat: CATS.includes(cat) ? cat : 'Divers', src: src || 'moi', ts: Date.now() };
      this.items.push(it);
      await this.save();
      return it;
    },
    async update(id, text, cat) {
      const it = this.items.find((m) => m.id === id);
      if (!it) return null;
      if (text != null) it.text = String(text).trim();
      if (cat) it.cat = cat;
      it.ts = Date.now();
      await this.save();
      return it;
    },
    async remove(id) {
      const n = this.items.length;
      this.items = this.items.filter((m) => m.id !== id);
      await this.save();
      return this.items.length !== n;
    },
    forPrompt() {
      if (!this.items.length) return '(vide pour l\'instant)';
      const byCat = {};
      this.items.forEach((m) => { (byCat[m.cat] = byCat[m.cat] || []).push(m); });
      let out = '';
      CATS.forEach((c) => {
        if (!byCat[c]) return;
        out += '\n## ' + c + '\n' + byCat[c].map((m) => '- [' + m.id + '] ' + m.text).join('\n');
      });
      // garde-fou de taille
      if (out.length > 40000) out = out.slice(out.length - 40000);
      return out.trim();
    }
  };

  // ============================================================
  //  Recherche plein texte (documents)
  // ============================================================
  const STOP = new Set(('les des une est que qui dans pour par sur avec pas plus son ses aux du de la le un et en au ce cette ces ou il elle on nous vous ils elles se sa leur leurs mais comme tout tous toute toutes être avoir fait faire peut doit sont été très aussi entre sans sous chez dont quoi quel quelle quels quelles comment combien quand pourquoi est-ce ça cela the and for are with this that from').split(' '));

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function tokens(s) {
    return norm(s).split(/[^a-z0-9₂²³]+/).filter((w) => w.length >= 2 && !STOP.has(w)).map((w) => {
      if (w.length > 4) w = w.replace(/(s|x)$/, '');
      return w;
    });
  }

  const Docs = {
    list: [],
    chunks: {},  // id -> [{p, t, tk}]
    async load() {
      this.list = (await DB.get('docs')) || [];
      for (const d of this.list) {
        const c = (await DB.get('doc:' + d.id)) || [];
        this.chunks[d.id] = c.map((x) => ({ p: x.p, t: x.t, tk: tokens(x.t) }));
      }
    },
    saveList() { return DB.set('docs', this.list); },
    async addDoc(meta, pages) {
      // pages : [{p, text}]
      const chunks = chunkPages(pages);
      await DB.set('doc:' + meta.id, chunks);
      this.chunks[meta.id] = chunks.map((x) => ({ p: x.p, t: x.t, tk: tokens(x.t) }));
      this.list.unshift(meta);
      await this.saveList();
    },
    async remove(id) {
      this.list = this.list.filter((d) => d.id !== id);
      delete this.chunks[id];
      await DB.del('doc:' + id);
      await this.saveList();
    },
    search(query, k) {
      const q = Array.from(new Set(tokens(query)));
      if (!q.length) return [];
      // fréquence documentaire
      let N = 0;
      const df = {};
      const all = [];
      this.list.forEach((d) => {
        (this.chunks[d.id] || []).forEach((c) => {
          N++;
          const set = new Set(c.tk);
          q.forEach((w) => { if (set.has(w)) df[w] = (df[w] || 0) + 1; });
          all.push({ d: d, c: c });
        });
      });
      if (!N) return [];
      const res = [];
      all.forEach(({ d, c }) => {
        let score = 0;
        const len = c.tk.length || 1;
        const tf = {};
        c.tk.forEach((w) => { tf[w] = (tf[w] || 0) + 1; });
        let hits = 0;
        q.forEach((w) => {
          if (!tf[w]) return;
          hits++;
          const idf = Math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5));
          score += idf * (tf[w] * 2.2) / (tf[w] + 1.2 * (0.25 + 0.75 * len / 220));
        });
        if (score > 0) {
          score *= (1 + hits / q.length);
          // bonus si le nom du document correspond
          const dn = norm(d.name);
          q.forEach((w) => { if (dn.includes(w)) score *= 1.15; });
          res.push({ doc: d, page: c.p, text: c.t, score: score });
        }
      });
      res.sort((a, b) => b.score - a.score);
      return res.slice(0, k || 6);
    },
    forPrompt() {
      if (!this.list.length) return 'Aucun document pour l\'instant.';
      return this.list.map((d) => '- « ' + d.name + ' » (' + (d.pages ? d.pages + ' p.' : d.type) + ')' + (d.summary ? ' : ' + d.summary.replace(/\s+/g, ' ').slice(0, 300) : '')).join('\n');
    }
  };

  function chunkPages(pages) {
    const out = [];
    const SIZE = 1400;
    const OVER = 200;
    pages.forEach((pg) => {
      const text = String(pg.text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (!text) return;
      if (text.length <= SIZE + 300) { out.push({ p: pg.p, t: text }); return; }
      let i = 0;
      while (i < text.length) {
        let end = Math.min(text.length, i + SIZE);
        if (end < text.length) {
          const cut = text.lastIndexOf(' ', end);
          if (cut > i + SIZE * 0.6) end = cut;
        }
        out.push({ p: pg.p, t: text.slice(i, end).trim() });
        if (end >= text.length) break;
        i = end - OVER;
      }
    });
    return out;
  }

  function excerptsText(results, budget) {
    let used = 0;
    const parts = [];
    for (const r of results) {
      const t = '<extrait document="' + r.doc.name + '"' + (r.page ? ' page="' + r.page + '"' : '') + '>\n' + r.text + '\n</extrait>';
      if (used + t.length > budget) break;
      used += t.length;
      parts.push(t);
    }
    return parts.join('\n\n');
  }

  // ============================================================
  //  Le cerveau : consignes, outils, boucle d'appel
  // ============================================================
  const PERSONA = `Tu es **Manaen**, l'assistant professionnel personnel de Franck. Tu tournes dans une appli Android que Franck a fait créer rien que pour lui. Tu le tutoies, tu parles français, avec le ton d'un collègue expérimenté, direct et bienveillant.

# Tes domaines d'expertise
- **Génie climatique / CVC** : climatisation, pompes à chaleur air/air et air/eau, VRV/DRV (Daikin, Mitsubishi, Toshiba, Atlantic…), groupes froid, CTA, ventilation (VMC simple et double flux), chauffage (chaudières gaz/fioul/bois, planchers chauffants, radiateurs, émetteurs), régulation, équilibrage, hydraulique, ECS, énergies renouvelables (solaire thermique, PAC, géothermie).
- **Froid** : cycle frigorifique, diagrammes enthalpiques, surchauffe/sous-refroidissement, fluides (R32, R410A, R454B, R290, R744…), brasage, tirage au vide, charge, recherche de fuites, mise en service, dépannage, lecture de codes défaut.
- **Plomberie et bâtiment** : sanitaire, évacuations, gaz, dimensionnement de réseaux, second œuvre, menuiserie, toiture, isolation, DTU (60.1, 60.11, 61.1, 65.x, 68.3, 36.5…), RE2020, thermique du bâtiment, bilans de déperditions.
- **Réglementation et sécurité** : règlement F-gaz (UE) et attestation de capacité, contrôles d'étanchéité, NF EN 378, fluides A2L/A3, habilitation électrique, consignation, EPI, prévention des risques sur chantier.
- **Enseignement** : préparation de cours, séances, TP, évaluations et corrigés pour les bacs pro (MEE, ICCER, MFER…) et CAP du génie climatique, avec repères sur les référentiels (compétences, savoirs associés) ; préparation du concours CAPLP (oraux, dossiers, didactique).

# Ta manière de répondre
- Va droit au but : la réponse utile d'abord, les détails ensuite. Franck lit sur son téléphone, souvent sur chantier : paragraphes courts, listes, petits tableaux quand ça aide.
- Pour un **calcul**, pose la formule, les valeurs avec leurs unités, le résultat, et un ordre de grandeur pour vérifier.
- Pour un **dépannage**, raisonne comme un technicien : causes les plus probables d'abord, vérifications concrètes dans l'ordre, valeurs normales attendues, et quand appeler le constructeur.
- Pour un **cours**, structure : objectifs, prérequis, déroulé minuté, activités élèves, évaluation, en restant au niveau des élèves.
- Sois honnête sur tes limites : si une valeur, un code défaut ou un article de norme dépend du modèle ou de la version, dis-le et invite à vérifier la notice constructeur ou le texte officiel. N'invente jamais une référence de norme, un code erreur ou un chiffre précis dont tu n'es pas sûr.
- Rappelle la sécurité quand c'est vraiment utile (fluide inflammable, électricité, gaz, travail en hauteur), sans faire la morale.
- Utilise ce que tu sais de Franck (mémoire ci-dessous) pour adapter tes réponses, sans le lui réciter.

# Ta mémoire : tu apprends au fil des discussions
Tu as une mémoire permanente (liste plus bas). Chaque info a un identifiant [mN].
- Quand Franck te dit de retenir quelque chose, appelle l'outil \`memoriser\`.
- {{AUTO}}
- S'il te corrige ou qu'une info a changé, appelle \`corriger_memoire\` sur la bonne ligne (texte vide = supprimer).
- Écris chaque info comme une phrase courte et autonome, à la 1re personne de Franck (« Je… », « Sur mes chantiers… »).
- Ne mémorise jamais de mot de passe, code d'accès, clé, numéro bancaire ou info de santé.
- Après avoir mémorisé, mentionne-le en une demi-phrase seulement, sans en faire un paragraphe.

# Ses documents
Franck peut te confier des documents (notices, référentiels, DTU, fiches). Des extraits pertinents te sont fournis automatiquement quand ils existent. Si ça ne suffit pas, utilise l'outil \`rechercher_documents\` avec des mots-clés précis (tu peux l'appeler plusieurs fois avec d'autres mots). Quand tu t'appuies sur un document, cite-le brièvement : (Notice XYZ, p. 12).

# Chiffrage, étude de prix et coefficient de vente (Kv)
Franck fait ses études de prix comme en formation. Vocabulaire :
- **DS** (déboursé sec) = fournitures/matériaux + main-d'œuvre (heures × taux horaire chargé) + matériel directement liés à l'ouvrage.
- **FC** (frais de chantier) : installation et repli, encadrement, nettoyage, transports, petit outillage, consommables…
- **FOP** (frais d'opération) : frais propres à l'affaire (études, assurances, garanties, frais de dossier, déplacements…).
- **FG** (frais généraux) : structure de l'entreprise (siège, administratif, commercial, bureau d'études).
- **CR** (coût de revient) = DS + FC + FOP + FG.
- **B&A** (bénéfices et aléas). **PV HT** = CR + B&A. **PV TTC** = PV HT × (1 + TVA) (20 %, 10 % ou 5,5 % selon les travaux et le local).
- **Kv** = PV HT / DS, donc PV HT d'un ouvrage = DS × Kv.
Les **bases des pourcentages changent selon les formations** : par ex. FC en % du DS et FOP, FG, B&A en % du PV HT, ce qui donne PV HT × (1 − %FOP − %FG − %B&A) = DS × (1 + %FC), soit **Kv = (1 + %FC) / (1 − %FOP − %FG − %B&A)**. Si un pourcentage est sur le DS, sur le coût direct (DS + FC) ou sur le CR, la formule change : pose-la proprement à partir des définitions.
- Si la mémoire ne dit pas sur quelle base Franck calcule chaque frais, demande-le une fois (ou suis l'énoncé), puis mémorise sa méthode (catégorie Technique) et applique-la toujours.
- Présente toujours : la formule littérale, le calcul étape par étape dans un tableau (DS → FC → FOP → FG → CR → B&A → PV HT → Kv), les résultats arrondis (Kv à 3 décimales, montants à 2 décimales), puis une vérification (DS × Kv = PV HT).
- Pour un devis, un DQE ou une DPGF : colonnes Désignation, Unité, Quantité, PU DS, Total DS, puis Kv, PU vente HT, Total vente HT, et totaux HT, TVA, TTC.

# Fichiers Excel
Quand un tableau de calcul serait utile en fichier (chiffrage, Kv, quantitatif, métré, DQE, DPGF, bilan, planning, notes…), ou si Franck le demande, appelle l'outil \`creer_tableur\`. Mets de **vraies formules Excel** pour que le fichier se recalcule s'il change une valeur : syntaxe anglaise (SUM, ROUND, IF, PRODUCT), séparateur virgule, point décimal, références A1 (ex. "=C2*D2", "=SUM(E2:E9)", "=ROUND(B12/B2,3)"). Ligne 1 = en-têtes. Formats possibles par cellule : {"v": …, "format": "euro" | "pourcent" | "nombre", "gras": true}. Un pourcentage s'écrit en décimal (0.12 avec format pourcent). Vérifie bien que chaque référence pointe sur la bonne cellule. Montre aussi le résultat dans ta réponse.
Sous chacune de tes réponses, Franck a des boutons pour l'exporter en Word ou en PDF, et en Excel s'il y a des tableaux : pour un cours, une fiche ou un rapport, rédige donc proprement en Markdown (titres, listes, tableaux) pour que l'export soit propre.{{WEB}}{{VOIX}}{{CONSIGNES}}`;

  const AUTO_ON = 'Sans qu\'il le demande, mémorise aussi les infos **durables et utiles** qu\'il donne : ses habitudes de travail, ses préférences de réponse, ses chantiers et clients en cours, le matériel qu\'il utilise, ses classes et cours, ses méthodes et valeurs de réglage. Ne mémorise pas les détails ponctuels d\'une seule question, ni ce que tu as toi-même expliqué.';
  const AUTO_OFF = 'La mémoire automatique est désactivée : ne mémorise que si Franck le demande explicitement.';
  const VOICE_TXT = '\n\n# Question dictée à la voix\nCette question a été dictée (la reconnaissance vocale peut avoir mal compris un mot technique : corrige mentalement) et ta réponse sera lue à voix haute. Réponds de façon courte et orale : phrases simples, pas de tableau ni de longue liste, les chiffres clés d\'abord. Propose d\'envoyer le détail par écrit si c\'est long.';
  const WEB_TXT = '\n\n# Recherche sur Internet\nTu peux chercher sur le web (outil web_search) pour les prix, la réglementation récente, les fiches et notices constructeurs. Ne le fais que si c\'est utile, et donne les sources.';

  function buildTools() {
    const tools = [
      {
        name: 'memoriser',
        description: 'Enregistre dans la mémoire permanente de Manaen une information durable sur Franck, son travail, ses préférences, ou une connaissance technique qu\'il t\'apprend.',
        input_schema: {
          type: 'object',
          properties: {
            fait: { type: 'string', description: 'L\'information, en une phrase courte et autonome, à la 1re personne de Franck.' },
            categorie: { type: 'string', enum: CATS, description: 'Moi = qui il est et ses préférences ; Chantiers = chantiers, clients, matériel ; Technique = méthodes, réglages, astuces ; Enseignement = cours, classes, concours ; Divers = le reste.' }
          },
          required: ['fait', 'categorie']
        }
      },
      {
        name: 'corriger_memoire',
        description: 'Corrige ou supprime une information de la mémoire, par son identifiant [mN].',
        input_schema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Identifiant, ex. m12' },
            nouveau_texte: { type: 'string', description: 'Nouveau texte. Chaîne vide pour supprimer.' }
          },
          required: ['id', 'nouveau_texte']
        }
      },
      {
        name: 'rechercher_documents',
        description: 'Recherche par mots-clés dans les documents de Franck (notices, référentiels, DTU…). Renvoie les extraits les plus pertinents avec le nom du document et la page.',
        input_schema: {
          type: 'object',
          properties: {
            requete: { type: 'string', description: 'Mots-clés précis (termes techniques, références, codes).' }
          },
          required: ['requete']
        }
      },
      {
        name: 'creer_tableur',
        description: 'Crée un fichier Excel (.xlsx) avec de vraies formules, que Franck peut ouvrir et enregistrer sur son téléphone. Pour chiffrages, Kv, quantitatifs, DQE/DPGF, métrés, bilans, notes d\'élèves…',
        input_schema: {
          type: 'object',
          properties: {
            nom_fichier: { type: 'string', description: 'Nom du fichier sans extension, ex. "Kv chantier Dupont"' },
            feuilles: {
              type: 'array',
              description: 'Une ou plusieurs feuilles.',
              items: {
                type: 'object',
                properties: {
                  nom: { type: 'string', description: 'Nom de l\'onglet (31 caractères max)' },
                  lignes: {
                    type: 'array',
                    description: 'Lignes du tableau, de haut en bas. Chaque ligne est une liste de cellules. Une cellule est un texte, un nombre, une formule commençant par "=", ou un objet {"v": valeur ou formule, "format": "euro"|"pourcent"|"nombre", "gras": true}.',
                    items: { type: 'array', items: {} }
                  },
                  largeurs: { type: 'array', items: { type: 'number' }, description: 'Largeurs de colonnes facultatives (en caractères).' }
                },
                required: ['nom', 'lignes']
              }
            }
          },
          required: ['nom_fichier', 'feuilles']
        }
      }
    ];
    if (Settings.data.webSearch) {
      tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 4, user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' } });
    }
    return tools;
  }

  function buildSystem(excerpts, voice) {
    const consignes = (Settings.data.consignes || '').trim();
    const persona = PERSONA
      .replace('{{AUTO}}', Settings.data.autoMemory ? AUTO_ON : AUTO_OFF)
      .replace('{{WEB}}', Settings.data.webSearch ? WEB_TXT : '')
      .replace('{{VOIX}}', '')
      .replace('{{CONSIGNES}}', consignes ? '\n\n# Consignes personnelles de Franck (prioritaires sur tout ce qui précède, sauf la sécurité et l\'honnêteté)\n' + consignes : '');
    const now = new Date();
    const blocks = [
      { type: 'text', text: persona, cache_control: { type: 'ephemeral' } },
      {
        type: 'text',
        text: '# Mémoire permanente (ce que tu sais de Franck)\n' + Memory.forPrompt() +
          '\n\n# Documents disponibles\n' + Docs.forPrompt(),
        cache_control: { type: 'ephemeral' }
      }
    ];
    let ctx = '# Contexte\nDate : ' + now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ', ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '.';
    if (excerpts) ctx += '\n\n# Extraits de ses documents qui semblent liés à la question\n' + excerpts;
    if (voice) ctx += VOICE_TXT;
    blocks.push({ type: 'text', text: ctx });
    return blocks;
  }

  async function runClientTool(name, input, turn) {
    try {
      if (name === 'memoriser') {
        const it = await Memory.add(input.fait, input.categorie, 'auto');
        if (!it) return 'Rien à mémoriser (texte vide).';
        turn.memChips.push('Retenu : ' + it.text);
        return 'Mémorisé sous [' + it.id + '].';
      }
      if (name === 'corriger_memoire') {
        const id = String(input.id || '').replace(/[\[\]]/g, '');
        const txt = String(input.nouveau_texte || '').trim();
        if (!txt) {
          const old = Memory.items.find((m) => m.id === id);
          const ok = await Memory.remove(id);
          if (ok) turn.memChips.push('Oublié : ' + (old ? old.text : id));
          return ok ? 'Supprimé.' : 'Identifiant introuvable.';
        }
        const it = await Memory.update(id, txt);
        if (!it) return 'Identifiant introuvable.';
        turn.memChips.push('Corrigé : ' + it.text);
        return 'Corrigé.';
      }
      if (name === 'creer_tableur') {
        const feuilles = Array.isArray(input.feuilles) ? input.feuilles : [];
        if (!feuilles.length) return 'Erreur : aucune feuille fournie.';
        const nom = String(input.nom_fichier || 'Tableau Manaen').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Tableau Manaen';
        window.Files.xlsx(feuilles); // vérifie que le fichier se fabrique
        turn.files.push({ kind: 'xlsx', name: nom + '.xlsx', spec: feuilles });
        const nl = feuilles.reduce((n, f) => n + (f.lignes || []).length, 0);
        return 'Fichier « ' + nom + '.xlsx » créé (' + feuilles.length + ' feuille(s), ' + nl + ' lignes). Franck a un bouton sous ta réponse pour l\'ouvrir ou l\'enregistrer.';
      }
      if (name === 'rechercher_documents') {
        if (!Docs.list.length) return 'Franck n\'a encore ajouté aucun document.';
        const r = Docs.search(input.requete, 6);
        if (!r.length) return 'Aucun extrait trouvé pour « ' + input.requete + ' ». Essaie d\'autres mots-clés.';
        return excerptsText(r, 14000);
      }
      return 'Outil inconnu.';
    } catch (e) {
      return 'Erreur de l\'outil : ' + e.message;
    }
  }

  // Répare un historique abîmé (réponse coupée au milieu d'un appel d'outil, etc.)
  function sanitize(api) {
    const out = [];
    for (let i = 0; i < api.length; i++) {
      let m = api[i];
      if (m.role === 'assistant' && Array.isArray(m.content)) {
        const next = api[i + 1];
        const results = new Set();
        if (next && next.role === 'user' && Array.isArray(next.content)) next.content.forEach((b) => { if (b.type === 'tool_result') results.add(b.tool_use_id); });
        const webDone = new Set(m.content.filter((b) => b.type === 'web_search_tool_result').map((b) => b.tool_use_id));
        let c = m.content.filter((b) => {
          if (b.type === 'tool_use') return results.has(b.id);
          if (b.type === 'server_tool_use') return webDone.has(b.id);
          return true;
        });
        if (!c.some((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking')) c = [{ type: 'text', text: '…' }];
        if (c.length !== m.content.length || c !== m.content) m = { role: 'assistant', content: c };
      } else if (m.role === 'user' && Array.isArray(m.content)) {
        const prev = out[out.length - 1];
        const asked = new Set();
        if (prev && prev.role === 'assistant' && Array.isArray(prev.content)) prev.content.forEach((b) => { if (b.type === 'tool_use') asked.add(b.id); });
        const c = m.content.filter((b) => b.type !== 'tool_result' || asked.has(b.tool_use_id));
        if (c.length !== m.content.length) m = { role: 'user', content: c.length ? c : [{ type: 'text', text: '(suite)' }] };
      }
      // jamais deux messages du même rôle à la suite
      const prev = out[out.length - 1];
      if (prev && prev.role === m.role) {
        const toArr = (x) => (typeof x.content === 'string' ? [{ type: 'text', text: x.content }] : x.content);
        out[out.length - 1] = { role: m.role, content: toArr(prev).concat(toArr(m)) };
        continue;
      }
      out.push(m);
    }
    return out;
  }

  // Préparer l'historique envoyé : on garde une fenêtre raisonnable.
  function windowMessages(api) {
    api = sanitize(api);
    const MAX_CHARS = 160000;
    let start = Math.max(0, api.length - 40);
    const isPlainUser = (m) => m.role === 'user' && (typeof m.content === 'string' || !m.content.some((b) => b.type === 'tool_result'));
    while (start < api.length && !isPlainUser(api[start])) start++;
    let msgs = api.slice(start);
    while (msgs.length > 2 && JSON.stringify(msgs).length > MAX_CHARS) {
      let i = 1;
      while (i < msgs.length && !isPlainUser(msgs[i])) i++;
      if (i >= msgs.length) break;
      msgs = msgs.slice(i);
    }
    // Les blocs de réflexion (thinking) ne sont valables que pendant le tour en cours :
    // on les retire des tours précédents, sinon l'API refuse la demande.
    let lastPlain = -1;
    msgs.forEach((m, k) => { if (isPlainUser(m)) lastPlain = k; });
    return msgs.map((m, k) => {
      if (k >= lastPlain || m.role !== 'assistant' || !Array.isArray(m.content)) return m;
      const c = m.content.filter((bl) => bl.type !== 'thinking' && bl.type !== 'redacted_thinking');
      if (c.length === m.content.length) return m;
      return { role: 'assistant', content: c.length ? c : [{ type: 'text', text: '…' }] };
    });
  }

  // Supprime les données binaires (photos, PDF) des anciens messages pour garder l'historique léger.
  function lighten(content) {
    if (!Array.isArray(content)) return content;
    return content.map((b) => {
      if (b.type === 'image') return { type: 'text', text: '[Photo jointe à ce message]' };
      if (b.type === 'document') return { type: 'text', text: '[PDF joint à ce message' + (b.title ? ' : ' + b.title : '') + ']' };
      return b;
    });
  }

  // ============================================================
  //  Discussions
  // ============================================================
  const Chats = {
    index: [],      // [{id, title, ts}]
    current: null,  // {id, title, ts, display:[], api:[]}
    async load() {
      this.index = (await DB.get('convs')) || [];
      const last = localStorage.getItem('manaen.current');
      if (last && this.index.find((c) => c.id === last)) this.current = await DB.get('conv:' + last);
      if (!this.current) this.current = this.blank();
    },
    blank() { return { id: uid(), title: '', ts: Date.now(), display: [], api: [] }; },
    async save() {
      const c = this.current;
      if (!c.display.length) return;
      c.ts = Date.now();
      await DB.set('conv:' + c.id, c);
      const i = this.index.findIndex((x) => x.id === c.id);
      const entry = { id: c.id, title: c.title || 'Discussion', ts: c.ts };
      if (i >= 0) this.index.splice(i, 1);
      this.index.unshift(entry);
      if (this.index.length > 200) {
        const old = this.index.splice(200);
        for (const o of old) await DB.del('conv:' + o.id);
      }
      await DB.set('convs', this.index);
      localStorage.setItem('manaen.current', c.id);
    },
    async open(id) {
      const c = await DB.get('conv:' + id);
      if (c) { this.current = c; localStorage.setItem('manaen.current', id); }
    },
    async remove(id) {
      this.index = this.index.filter((x) => x.id !== id);
      await DB.del('conv:' + id);
      await DB.set('convs', this.index);
      if (this.current && this.current.id === id) this.current = this.blank();
    },
    fresh() { this.current = this.blank(); localStorage.removeItem('manaen.current'); }
  };

  let busy = false;
  let speakAfter = null;
  let cancelled = false;
  let attachments = []; // {kind:'image'|'pdf', name, data(base64), media, thumb}

  async function sendMessage(text, viaVoice) {
    text = (text || '').trim();
    if (busy) return;
    if (!text && !attachments.length) return;
    if (!Settings.key) { openWelcome(); return; }

    const conv = Chats.current;
    const atts = attachments.slice();
    attachments = [];
    renderAttachments();

    const userDisplay = {
      role: 'user',
      text: text,
      images: atts.filter((a) => a.kind === 'image').map((a) => a.thumb),
      files: atts.filter((a) => a.kind === 'pdf').map((a) => a.name)
    };
    conv.display.push(userDisplay);
    if (!conv.title) conv.title = (text || (atts[0] && atts[0].name) || 'Discussion').slice(0, 60);

    const content = [];
    atts.forEach((a) => {
      if (a.kind === 'image') content.push({ type: 'image', source: { type: 'base64', media_type: a.media, data: a.data } });
      else content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name });
    });
    content.push({ type: 'text', text: text || 'Analyse ce que je t\'envoie.' });
    const userApiIndex = conv.api.length;
    conv.api.push({ role: 'user', content: content });

    renderMessages();
    setBusy(true);
    const status = showStatus('Manaen réfléchit…');

    const turn = { memChips: [], texts: [], sources: [], files: [] };
    const voiceMode = !!viaVoice && !!Settings.data.voiceRead;
    try {
      // Extraits automatiques de documents
      let excerpts = '';
      if (Docs.list.length && text) {
        const recent = conv.display.filter((m) => m.role === 'user').slice(-2).map((m) => m.text).join(' ');
        const r = Docs.search(recent, 4).filter((x) => x.score > 2);
        if (r.length) excerpts = excerptsText(r, 8000);
      }
      const system = buildSystem(excerpts, voiceMode);
      const tools = buildTools();
      let guard = 0;
      while (guard++ < 10) {
        if (cancelled) break;
        const res = await callClaude({
          model: Settings.data.model,
          max_tokens: 32000,
          system: system,
          tools: tools,
          messages: windowMessages(conv.api)
        });
        if (cancelled) break;
        conv.api.push({ role: 'assistant', content: res.content });
        res.content.forEach((b) => {
          if (b.type === 'text' && b.text) {
            turn.texts.push(b.text);
            (b.citations || []).forEach((c) => {
              if (c.url && !turn.sources.find((s) => s.url === c.url)) turn.sources.push({ url: c.url, title: c.title || c.url });
            });
          }
          if (b.type === 'server_tool_use' && b.name === 'web_search') status.set('Recherche sur Internet : ' + ((b.input && b.input.query) || '…'));
        });
        if (res.stop_reason === 'pause_turn') continue;
        if (res.stop_reason === 'tool_use') {
          const results = [];
          for (const b of res.content) {
            if (b.type !== 'tool_use') continue;
            if (b.name === 'rechercher_documents') status.set('Je cherche dans tes documents : ' + (b.input.requete || ''));
            else if (b.name === 'memoriser') status.set('Je retiens ça…');
            else if (b.name === 'creer_tableur') status.set('Je prépare le fichier Excel…');
            else status.set('Je mets à jour ma mémoire…');
            const out = await runClientTool(b.name, b.input || {}, turn);
            results.push({ type: 'tool_result', tool_use_id: b.id, content: out });
          }
          conv.api.push({ role: 'user', content: results });
          status.set('Manaen rédige…');
          continue;
        }
        if (res.stop_reason === 'max_tokens') {
          const cut = res.content.filter((b) => b.type === 'tool_use');
          if (cut.length && !turn.cutRetry) {
            turn.cutRetry = true;
            conv.api.push({
              role: 'user',
              content: cut.map((b) => ({
                type: 'tool_result', tool_use_id: b.id, is_error: true,
                content: 'Ta réponse a été coupée car trop longue : cet outil n\'a pas reçu ses données complètes. Recommence en plus court (moins de lignes, ou plusieurs fichiers/feuilles plus petits), sans répéter ce que tu as déjà écrit.'
              }))
            });
            status.set('Le fichier était trop long, Manaen recommence en plus court…');
            continue;
          }
          turn.texts.push('\n\n*(Réponse coupée car trop longue : demande-moi « continue ».)*');
        }
        break;
      }
      if (cancelled) {
        // On retire le tour incomplet de l'historique API pour garder une suite valide
        conv.api.splice(userApiIndex);
        conv.api.push({ role: 'user', content: lighten(content) });
        conv.api.push({ role: 'assistant', content: [{ type: 'text', text: turn.texts.join('\n\n') || '(réponse interrompue)' }] });
        turn.texts.push('*(interrompu)*');
      }
      // Si la dernière réponse est un appel d'outil sans suite (garde atteinte), on referme proprement
      const last = conv.api[conv.api.length - 1];
      if (last && last.role === 'user') conv.api.push({ role: 'assistant', content: [{ type: 'text', text: turn.texts.join('\n\n') || '…' }] });

      conv.api[userApiIndex] = { role: 'user', content: lighten(content) };
      conv.display.push({
        role: 'assistant',
        text: turn.texts.join('\n\n').trim() || '(pas de réponse)',
        mem: turn.memChips,
        sources: turn.sources.slice(0, 8),
        files: turn.files
      });
      if (voiceMode && !cancelled) speakAfter = conv.display.length - 1;
    } catch (e) {
      // Erreur : on retire le tour de l'historique API pour pouvoir réessayer
      conv.api.splice(userApiIndex);
      conv.display.push({ role: 'assistant', error: true, text: e.message || String(e), retry: text });
    } finally {
      status.remove();
      setBusy(false);
      cancelled = false;
      await Chats.save();
      renderMessages();
      if (turn.memChips.length && currentView === 'memory') renderMemory();
      if (speakAfter != null) { const k = speakAfter; speakAfter = null; speakMessage(k); }
    }
  }

  // ============================================================
  //  Ingestion de documents
  // ============================================================
  function readAsArrayBuffer(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file); });
  }
  function readAsText(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file); });
  }
  function readAsDataURL(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
  }
  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }

  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Image illisible')); i.src = src; });
  }
  async function resizeImage(dataUrl, max, quality) {
    const img = await loadImage(dataUrl);
    let w = img.naturalWidth, h = img.naturalHeight;
    const s = Math.min(1, max / Math.max(w, h));
    w = Math.round(w * s); h = Math.round(h * s);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality || 0.85);
  }

  let pdfjsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsPromise) {
      pdfjsPromise = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = PDFJS + 'pdf.min.js';
        s.onload = () => {
          if (!window.pdfjsLib) return rej(new Error('pdf.js absent'));
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
          res(window.pdfjsLib);
        };
        s.onerror = () => { pdfjsPromise = null; rej(new Error('Lecteur PDF non chargé (connexion ?)')); };
        document.head.appendChild(s);
      });
    }
    return pdfjsPromise;
  }

  const TRANSCRIBE_PROMPT = 'Transcris fidèlement et intégralement le texte de ces pages, dans l\'ordre, en français tel quel. ' +
    'Commence chaque page par une ligne « === Page N === » (N = numéro indiqué). Reproduis les tableaux en Markdown. ' +
    'Pour les schémas, photos ou plans, écris une courte description entre crochets avec les valeurs et repères lisibles. ' +
    'Ne commente pas, ne résume pas.';

  function splitPagesFromTranscript(txt, fallbackPage) {
    const parts = txt.split(/^=== ?Page (\d+) ?===\s*$/m);
    const pages = [];
    if (parts.length < 3) return [{ p: fallbackPage || 1, text: txt.trim() }];
    if (parts[0].trim()) pages.push({ p: fallbackPage || 1, text: parts[0].trim() });
    for (let i = 1; i < parts.length; i += 2) pages.push({ p: parseInt(parts[i], 10), text: (parts[i + 1] || '').trim() });
    return pages;
  }

  async function transcribeImages(images, firstPage, labelPages) {
    // images : [dataURL jpeg], une par page
    const content = [];
    images.forEach((d, i) => {
      if (labelPages) content.push({ type: 'text', text: 'Page ' + (firstPage + i) + ' :' });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d.split(',')[1] } });
    });
    content.push({ type: 'text', text: labelPages ? TRANSCRIBE_PROMPT : 'Transcris fidèlement tout le texte visible sur cette image (tableaux en Markdown), puis décris en quelques lignes ce qu\'elle montre d\'un point de vue technique (matériel, schéma, valeurs, références). Ne commente pas.' });
    const res = await callClaude({ model: FAST_MODEL, max_tokens: 8000, messages: [{ role: 'user', content: content }] });
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  }

  async function transcribeWholePdf(b64, name, onProgress) {
    // Lecture directe du PDF par Claude, par morceaux successifs
    const doc = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 }, cache_control: { type: 'ephemeral' } };
    const msgs = [{ role: 'user', content: [doc, { type: 'text', text: TRANSCRIBE_PROMPT + ' Utilise les numéros de page du fichier. Si tu n\'as pas le temps de tout finir, arrête-toi à la fin d\'une page et termine par la ligne <<SUITE>>.' }] }];
    let all = '';
    for (let i = 0; i < 12; i++) {
      onProgress && onProgress('Lecture par Manaen (partie ' + (i + 1) + ')…');
      const res = await callClaude({ model: FAST_MODEL, max_tokens: 16000, messages: msgs });
      const t = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const more = /<<SUITE>>\s*$/.test(t) || res.stop_reason === 'max_tokens';
      all += '\n' + t.replace(/<<SUITE>>\s*$/, '');
      if (!more) break;
      msgs.push({ role: 'assistant', content: t });
      msgs.push({ role: 'user', content: 'Continue la transcription à partir de la page suivante, même format.' });
    }
    return splitPagesFromTranscript(all.trim(), 1);
  }

  async function extractPdf(file, onProgress) {
    const buf = await readAsArrayBuffer(file);
    let lib = null;
    try { lib = await loadPdfJs(); } catch (e) { lib = null; }
    if (!lib) {
      if (file.size > 24 * 1024 * 1024) throw new Error('PDF trop gros (24 Mo max).');
      return { pages: await transcribeWholePdf(bufToB64(buf), file.name, onProgress), method: 'claude' };
    }
    const pdf = await lib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      let txt = '';
      tc.items.forEach((it) => { txt += it.str + (it.hasEOL ? '\n' : ' '); });
      pages.push({ p: p, text: txt });
      if (p % 5 === 0) onProgress && onProgress('Lecture page ' + p + '/' + pdf.numPages + '…', p / pdf.numPages);
    }
    const chars = pages.reduce((s, x) => s + x.text.trim().length, 0);
    if (chars / pdf.numPages >= 80) return { pages: pages, method: 'texte' };

    // PDF scanné : on fait lire les pages en image par Claude
    const ok = await confirmBox('PDF scanné', '« ' + esc(file.name) + ' » est un scan (' + pdf.numPages + ' pages) : Manaen doit le lire page par page avec son cerveau rapide. Ça coûte quelques centimes. On y va ?', 'Lire le scan');
    if (!ok) throw new Error('Lecture annulée.');
    const max = Math.min(pdf.numPages, 120);
    const out = [];
    const BATCH = 6;
    for (let start = 1; start <= max; start += BATCH) {
      const imgs = [];
      for (let p = start; p < start + BATCH && p <= max; p++) {
        const page = await pdf.getPage(p);
        const vp0 = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1500 / Math.max(vp0.width, vp0.height));
        const vp = page.getViewport({ scale: scale });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        imgs.push(c.toDataURL('image/jpeg', 0.8));
      }
      onProgress && onProgress('Lecture du scan : pages ' + start + ' à ' + Math.min(start + BATCH - 1, max) + ' sur ' + max + '…', start / max);
      const t = await transcribeImages(imgs, start, true);
      splitPagesFromTranscript(t, start).forEach((x) => out.push(x));
    }
    return { pages: out, method: 'scan' };
  }

  async function summarize(name, pages) {
    const sample = pages.map((p) => p.text).join('\n').slice(0, 9000);
    if (sample.trim().length < 40) return '';
    try {
      const res = await callClaude({
        model: FAST_MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: 'Voici le début du document « ' + name + ' ». En 2 phrases maximum et en français, dis de quoi il s\'agit (type de document, matériel ou sujet, marque/modèle, références). Pas d\'introduction.\n\n' + sample }]
      });
      return res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    } catch (e) {
      return '';
    }
  }

  let ingesting = false;
  async function ingestFiles(files) {
    if (!files.length) return;
    if (!Settings.key) { openWelcome(); return; }
    if (ingesting) { toast('Un document est déjà en cours de lecture.'); return; }
    ingesting = true;
    const box = $('#doc-progress');
    for (const file of files) {
      const prog = el('div', { class: 'progress' }, '<div><strong>' + esc(file.name) + '</strong></div><div class="muted small msg">Préparation…</div><div class="bar"><div></div></div>');
      box.prepend(prog);
      const setP = (msg, frac) => {
        $('.msg', prog).textContent = msg;
        if (frac != null) $('.bar > div', prog).style.width = Math.round(Math.min(1, frac) * 100) + '%';
      };
      try {
        const lower = file.name.toLowerCase();
        let pages, type, method = 'texte';
        if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
          type = 'PDF';
          const r = await extractPdf(file, setP);
          pages = r.pages; method = r.method;
        } else if (file.type.startsWith('image/')) {
          type = 'Photo';
          setP('Manaen lit l\'image…', 0.3);
          const d = await resizeImage(await readAsDataURL(file), 1600, 0.85);
          const t = await transcribeImages([d], 1, false);
          pages = [{ p: 0, text: t }];
          method = 'photo';
        } else if (/\.(docx?|xlsx?|pptx?|odt)$/.test(lower)) {
          throw new Error('Format Office non lu directement : enregistre-le en PDF puis ajoute le PDF.');
        } else {
          type = 'Texte';
          const t = await readAsText(file);
          pages = [{ p: 0, text: t }];
        }
        const total = pages.reduce((s, x) => s + (x.text || '').length, 0);
        if (total < 20) throw new Error('Aucun texte trouvé dans ce fichier.');
        setP('Manaen résume le document…', 0.9);
        const summary = await summarize(file.name, pages);
        const meta = {
          id: uid(),
          name: file.name.replace(/\.[^.]+$/, ''),
          type: type,
          pages: type === 'PDF' ? pages.length : 0,
          chars: total,
          method: method,
          summary: summary,
          ts: Date.now()
        };
        await Docs.addDoc(meta, pages);
        setP('Prêt ✔', 1);
        setTimeout(() => prog.remove(), 1500);
        renderDocs();
      } catch (e) {
        setP('Échec : ' + (e.message || e), 1);
        $('.bar', prog).remove();
        prog.classList.add('bad');
        setTimeout(() => prog.remove(), 9000);
      }
    }
    ingesting = false;
  }

  // ============================================================
  //  Pièces jointes dans la discussion
  // ============================================================
  async function addChatFiles(files) {
    for (const f of files) {
      try {
        if (f.type.startsWith('image/')) {
          const d = await resizeImage(await readAsDataURL(f), 1568, 0.85);
          const thumb = await resizeImage(d, 240, 0.7);
          attachments.push({ kind: 'image', name: f.name, media: 'image/jpeg', data: d.split(',')[1], thumb: thumb });
        } else if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
          if (f.size > 20 * 1024 * 1024) { toast('PDF trop gros pour la discussion (20 Mo max). Ajoute-le dans Documents.'); continue; }
          attachments.push({ kind: 'pdf', name: f.name, data: bufToB64(await readAsArrayBuffer(f)) });
        } else {
          toast('Format non pris en charge ici : photo ou PDF.');
        }
      } catch (e) {
        toast('Fichier illisible : ' + f.name);
      }
    }
    renderAttachments();
  }

  function renderAttachments() {
    const row = $('#attach-row');
    row.innerHTML = '';
    attachments.forEach((a, i) => {
      const it = el('div', { class: 'att' }, (a.kind === 'image' ? '<img src="' + a.thumb + '">' : '<div class="pdf">PDF</div>') + '<span>' + esc(a.name) + '</span>');
      it.appendChild(el('button', { onclick: () => { attachments.splice(i, 1); renderAttachments(); } }, '✕'));
      row.appendChild(it);
    });
    updateSendBtn();
  }

  // ============================================================
  //  Interface : discussion
  // ============================================================
  function renderMessages(keepScroll) {
    const box = $('#messages');
    const prevScroll = box.scrollTop;
    const conv = Chats.current;
    box.innerHTML = '';
    if (!conv.display.length) {
      const e = el('div', { class: 'empty' });
      const h = new Date().getHours();
      const hello = h < 6 || h >= 18 ? 'Bonsoir' : 'Bonjour';
      const me = Memory.items.find((m) => /m'appelle\s+(\w+)/i.test(m.text));
      const name = me ? me.text.match(/m'appelle\s+([\wÀ-ÿ-]+)/i)[1] : '';
      e.innerHTML = '<div class="logo big"><span class="m-cold"></span><span class="m-warm"></span></div>' +
        '<h2>' + hello + (name ? ' ' + esc(name) : '') + ' 👋</h2>' +
        '<p class="muted">Clim, chauffage, froid, plomberie, bâtiment, cours… Pose ta question, envoie une photo de plaque ou de code défaut, ou apprends-moi quelque chose avec l\'ampoule.</p>';
      const sg = el('div', { class: 'suggest' });
      SUGGESTIONS.forEach(([tag, q]) => {
        sg.appendChild(el('button', { onclick: () => { $('#input').value = q; autoGrow(); updateSendBtn(); $('#input').focus(); } }, '<span class="tag">' + tag + '</span>' + esc(q)));
      });
      e.appendChild(sg);
      box.appendChild(e);
      return;
    }
    conv.display.forEach((m, idx) => {
      const wrap = el('div', { class: 'msg ' + m.role + (m.error ? ' error' : '') });
      if (m.role === 'user') {
        if (m.images && m.images.length) {
          const im = el('div', { class: 'msg-imgs' });
          m.images.forEach((t) => im.appendChild(el('img', { src: t })));
          wrap.appendChild(im);
        }
        (m.files || []).forEach((f) => wrap.appendChild(el('div', { class: 'msg-file' }, '📄 ' + esc(f))));
        if (m.text) wrap.appendChild(el('div', { class: 'bubble' }, esc(m.text)));
      } else {
        const b = el('div', { class: 'bubble' }, m.error ? '⚠️ ' + esc(m.text) : window.MD.render(m.text));
        wrap.appendChild(b);
        (m.mem || []).forEach((t) => wrap.appendChild(el('div', { class: 'mem-chip' }, '🧠 ' + esc(t))));
        (m.files || []).forEach((f) => {
          const card = el('div', { class: 'file-card' }, '<div class="doc-icon xl">XLS</div><div class="grow"><div class="doc-name">' + esc(f.name) + '</div><div class="muted small">Tableur Excel avec formules</div></div>');
          card.appendChild(el('button', { class: 'btn small-btn', onclick: () => saveXlsx(f.name, f.spec) }, 'Enregistrer'));
          wrap.appendChild(card);
        });
        if (m.sources && m.sources.length) {
          const s = el('div', { class: 'sources' });
          m.sources.forEach((x) => s.appendChild(el('a', { href: x.url, 'data-ext': '1' }, '🔗 ' + esc(x.title))));
          wrap.appendChild(s);
        }
        const acts = el('div', { class: 'msg-actions' });
        if (m.error && m.retry != null) {
          acts.appendChild(el('button', {
            onclick: () => {
              conv.display.splice(idx - 1, 2);
              renderMessages();
              sendMessage(m.retry);
            }
          }, '↻ Réessayer'));
        } else {
          acts.appendChild(el('button', { class: 'speak-btn' + (speakingIdx === idx ? ' on' : ''), onclick: () => speakMessage(idx) }, speakingIdx === idx ? '⏹ Stop' : '🔊 Lire'));
          acts.appendChild(el('button', { onclick: () => copyText(m.text) }, 'Copier'));
          if (window.Files.tablesFromMarkdown(m.text).length) acts.appendChild(el('button', { onclick: () => exportExcel(idx) }, '📊 Excel'));
          acts.appendChild(el('button', { onclick: () => exportWord(idx) }, '📝 Word'));
          acts.appendChild(el('button', { onclick: () => exportPdf(idx) }, '📄 PDF'));
        }
        wrap.appendChild(acts);
      }
      box.appendChild(wrap);
    });
    if (keepScroll) box.scrollTop = prevScroll;
    else requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  }

  // ------------------ Exports ------------------
  function titleFor(idx) {
    const conv = Chats.current;
    const m = conv.display[idx];
    const h = (m.text.match(/^#{1,3}\s+(.+)$/m) || [])[1];
    let q = '';
    for (let k = idx - 1; k >= 0; k--) if (conv.display[k].role === 'user') { q = conv.display[k].text; break; }
    let t = (h || q || conv.title || 'Manaen').replace(/[*_`#]/g, '').trim();
    if (t.length > 70) t = t.slice(0, 67).trim() + '…';
    return t;
  }
  function fileSafe(t) { return t.replace(/[\\/:*?"<>|…]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Manaen'; }

  function saveBytes(name, mime, bytes) {
    if (isNative()) {
      window.__onSaved = (ok) => toast(ok ? 'Fichier enregistré ✔' : 'Enregistrement annulé');
      window.ManaenNative.saveBase64(name, mime, window.Files.toB64(bytes));
    } else {
      const a = el('a', { href: URL.createObjectURL(new Blob([bytes], { type: mime })), download: name });
      document.body.appendChild(a); a.click(); a.remove();
    }
  }
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  function saveXlsx(name, spec) {
    try { saveBytes(name, XLSX_MIME, window.Files.xlsx(spec)); } catch (e) { toast('Fichier impossible : ' + e.message, 4000); }
  }
  function exportExcel(idx) {
    const m = Chats.current.display[idx];
    const tables = window.Files.tablesFromMarkdown(m.text);
    const sheets = tables.map((rows, i) => ({
      nom: 'Tableau ' + (i + 1),
      lignes: rows.map((r, ri) => ri === 0 ? r.map((c) => c.replace(/\*\*/g, '')) : r.map(window.Files.smartCell))
    }));
    saveXlsx(fileSafe(titleFor(idx)) + '.xlsx', sheets);
  }
  function exportWord(idx) {
    const m = Chats.current.display[idx];
    const t = titleFor(idx);
    try { saveBytes(fileSafe(t) + '.docx', DOCX_MIME, window.Files.docx(t, m.text)); } catch (e) { toast('Word impossible : ' + e.message, 4000); }
  }
  function exportPdf(idx) {
    const m = Chats.current.display[idx];
    const t = titleFor(idx);
    const html = window.Files.printHtml(t, m.text);
    if (isNative() && window.ManaenNative.printHtml) {
      toast('Choisis « Enregistrer au format PDF » en haut', 3500);
      window.ManaenNative.printHtml(html, fileSafe(t));
    } else {
      const w = window.open('', '_blank');
      if (!w) { toast('Fenêtre bloquée'); return; }
      w.document.write(html); w.document.close();
      setTimeout(() => w.print(), 400);
    }
  }

  // ------------------ Voix ------------------
  let speakingIdx = null;
  function speechText(md) {
    return window.Files.blocks(md).map((b) => {
      if (b.t === 'table') return b.rows.slice(1).map((r) => r.map((c, k) => (b.rows[0][k] ? b.rows[0][k] + ' : ' : '') + c).join(', ')).join('. ');
      if (b.t === 'code') return '';
      return b.text;
    }).join('.\n')
      .replace(/\*\*|__|`|~~|#+\s/g, '').replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[🧠🔗⚠️✔✖👋💡📊📝📄]/gu, '')
      .replace(/\.\.+/g, '.').replace(/\s*\.\s*\./g, '.')
      .replace(/ → /g, ', puis ').replace(/≈/g, 'environ ').replace(/×/g, ' fois ').replace(/ \/ /g, ' divisé par ')
      .replace(/(\d),(\d)/g, '$1 virgule $2');
  }
  function stopSpeaking() {
    if (isNative()) window.ManaenNative.stopSpeak();
    else if (window.speechSynthesis) window.speechSynthesis.cancel();
    speakingIdx = null;
  }
  function speakMessage(idx) {
    if (speakingIdx === idx) { stopSpeaking(); renderMessages(); return; }
    stopSpeaking();
    const m = Chats.current.display[idx];
    if (!m || m.role !== 'assistant' || m.error) return;
    const txt = speechText(m.text);
    if (!txt.trim()) return;
    speakingIdx = idx;
    if (isNative()) {
      if (window.ManaenNative.canSpeak && !window.ManaenNative.canSpeak()) {
        speakingIdx = null;
        toast('Voix française indisponible : installe « Synthèse vocale Google » dans les réglages du téléphone.', 5000);
        return;
      }
      window.ManaenNative.speak(txt);
    } else if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = 'fr-FR';
      const vs = window.speechSynthesis.getVoices().filter((v) => /^fr/i.test(v.lang));
      const best = vs.find((v) => /natural|online|google|neural/i.test(v.name)) || vs[0];
      if (best) u.voice = best;
      u.onend = () => window.__onSpeakEnd();
      window.speechSynthesis.speak(u);
    }
    renderMessages(true);
  }
  window.__onSpeakEnd = function () {
    if (speakingIdx == null) return;
    speakingIdx = null;
    renderMessages(true);
  };

  let listening = false;
  function startVoice() {
    if (busy) return;
    stopSpeaking();
    if (isNative()) {
      listening = true;
      window.ManaenNative.startVoice();
      return;
    }
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) { toast('Dictée indisponible ici.'); return; }
    const r = new R();
    r.lang = 'fr-FR';
    r.interimResults = false;
    listening = true;
    $('#btn-mic').classList.add('on');
    r.onresult = (e) => window.__onVoice(e.results[0][0].transcript);
    r.onerror = () => window.__onVoice(null);
    r.onend = () => { if (listening) window.__onVoice(null); };
    r.start();
  }
  window.__onVoice = function (text, err) {
    listening = false;
    $('#btn-mic').classList.remove('on');
    if (err === 'indisponible') { toast('Pas de reconnaissance vocale sur ce téléphone : installe ou active l\'appli Google.', 5000); return; }
    if (!text) return;
    text = text.charAt(0).toUpperCase() + text.slice(1);
    const input = $('#input');
    if (Settings.data.voiceAutoSend && !input.value.trim() && !attachments.length) {
      sendMessage(text, true);
    } else {
      input.value = (input.value.trim() ? input.value.trim() + ' ' : '') + text;
      autoGrow(); updateSendBtn();
      if (Settings.data.voiceAutoSend) { const t = input.value; input.value = ''; autoGrow(); sendMessage(t, true); }
    }
  };

  function showStatus(text) {
    const box = $('#messages');
    const s = el('div', { class: 'status-line' }, '<span class="dots"><span></span><span></span><span></span></span><span class="t"></span>');
    $('.t', s).textContent = text;
    box.appendChild(s);
    box.scrollTop = box.scrollHeight;
    return {
      set: (t) => { $('.t', s).textContent = t; },
      remove: () => s.remove()
    };
  }

  function copyText(t) {
    const done = () => toast('Copié');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => fallbackCopy(t));
    else fallbackCopy(t);
    function fallbackCopy(x) {
      const ta = el('textarea');
      ta.value = x;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Copie impossible'); }
      ta.remove();
    }
  }

  function setBusy(b) {
    busy = b;
    const s = $('#btn-send');
    s.classList.toggle('stop', b);
    s.innerHTML = b ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
    updateSendBtn();
  }
  function updateSendBtn() {
    const s = $('#btn-send');
    s.disabled = !busy && !$('#input').value.trim() && !attachments.length;
  }
  function autoGrow() {
    const t = $('#input');
    t.style.height = 'auto';
    t.style.height = Math.min(140, t.scrollHeight) + 'px';
  }

  // ============================================================
  //  Interface : mémoire
  // ============================================================
  let memFilter = 'Tout';
  function renderMemory() {
    const f = $('#mem-filters');
    f.innerHTML = '';
    ['Tout'].concat(CATS).forEach((c) => {
      const n = c === 'Tout' ? Memory.items.length : Memory.items.filter((m) => m.cat === c).length;
      f.appendChild(el('button', { class: 'chip' + (memFilter === c ? ' on' : ''), onclick: () => { memFilter = c; renderMemory(); } }, esc(c) + ' · ' + n));
    });
    const q = norm($('#mem-search').value);
    const list = $('#mem-list');
    list.innerHTML = '';
    const items = Memory.items
      .filter((m) => memFilter === 'Tout' || m.cat === memFilter)
      .filter((m) => !q || norm(m.text).includes(q))
      .slice().sort((a, b) => b.ts - a.ts);
    if (!items.length) {
      list.appendChild(el('div', { class: 'empty-list' }, q ? 'Rien trouvé.' : 'Rien ici pour l\'instant.'));
      return;
    }
    items.forEach((m) => {
      const it = el('div', { class: 'item' });
      const top = el('div', { class: 'item-top' }, '<div class="item-text">' + esc(m.text) + '</div>');
      const acts = el('div', { class: 'item-actions' });
      acts.appendChild(el('button', { onclick: () => editMemory(m) }, 'Modifier'));
      acts.appendChild(el('button', {
        onclick: async () => {
          if (await confirmBox('Oublier ?', esc(m.text), 'Oublier')) { await Memory.remove(m.id); renderMemory(); toast('Oublié'); }
        }
      }, '✕'));
      top.appendChild(acts);
      it.appendChild(top);
      it.appendChild(el('div', { class: 'item-meta' }, '<span class="badge">' + esc(m.cat) + '</span><span class="badge ' + (m.src === 'auto' ? 'auto">retenu seul' : 'moi">appris par toi') + '</span><span>' + fmtDate(m.ts) + '</span>'));
      list.appendChild(it);
    });
  }

  async function editMemory(m) {
    const body = '<textarea id="mem-edit" rows="5">' + esc(m.text) + '</textarea><select id="mem-cat">' + CATS.map((c) => '<option' + (c === m.cat ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>';
    const ok = await modal('Modifier', body, 'Enregistrer', () => $('#mem-edit').focus());
    if (!ok) return;
    const t = $('#mem-edit').value.trim();
    if (!t) { await Memory.remove(m.id); } else { await Memory.update(m.id, t, $('#mem-cat').value); }
    renderMemory();
  }

  let learnCat = 'Technique';
  function openLearn(prefill) {
    $('#learn-text').value = prefill || '';
    const c = $('#learn-cats');
    c.innerHTML = '';
    CATS.forEach((cat) => c.appendChild(el('button', { class: 'chip' + (cat === learnCat ? ' on' : ''), onclick: () => { learnCat = cat; openLearnCats(); } }, cat)));
    openSheet('sheet-learn');
    setTimeout(() => $('#learn-text').focus(), 250);
  }
  function openLearnCats() {
    $$('#learn-cats .chip').forEach((b) => b.classList.toggle('on', b.textContent === learnCat));
  }

  // ============================================================
  //  Interface : documents
  // ============================================================
  function renderDocs() {
    const list = $('#doc-list');
    list.innerHTML = '';
    if (!Docs.list.length) {
      list.appendChild(el('div', { class: 'empty-list' }, 'Aucun document. Ajoute une notice constructeur, un DTU ou ton référentiel, et Manaen s\'en servira pour te répondre.'));
      return;
    }
    Docs.list.forEach((d) => {
      const it = el('div', { class: 'item' });
      const icon = d.type === 'PDF' ? 'PDF' : d.type === 'Photo' ? 'IMG' : 'TXT';
      const row = el('div', { class: 'doc-row' }, '<div class="doc-icon">' + icon + '</div><div class="grow"><div class="doc-name">' + esc(d.name) + '</div>' +
        (d.summary ? '<div class="doc-sum">' + esc(d.summary) + '</div>' : '') +
        '<div class="item-meta">' + (d.pages ? '<span>' + d.pages + ' pages</span>' : '') + '<span>' + fmtNum(d.chars / 5.5) + ' mots</span>' + (d.method === 'scan' || d.method === 'claude' ? '<span class="badge">lu par Manaen</span>' : '') + '<span>' + fmtDate(d.ts) + '</span></div></div>');
      const acts = el('div', { class: 'item-actions' });
      acts.appendChild(el('button', {
        onclick: async () => {
          if (await confirmBox('Supprimer ?', 'Manaen ne pourra plus consulter « ' + esc(d.name) + ' ».', 'Supprimer')) { await Docs.remove(d.id); renderDocs(); }
        }
      }, '✕'));
      row.appendChild(acts);
      it.appendChild(row);
      list.appendChild(it);
    });
  }

  // ============================================================
  //  Interface : réglages
  // ============================================================
  function renderSettings() {
    $('#set-key').value = Settings.key;
    const ml = $('#set-model');
    ml.innerHTML = '';
    MODELS.forEach((m) => {
      ml.appendChild(el('button', {
        class: 'radio' + (Settings.data.model === m.id ? ' on' : ''),
        onclick: () => { Settings.data.model = m.id; Settings.save(); renderSettings(); updateBrand(); }
      }, '<span class="dot"></span><span><strong>' + m.name + '</strong><br><span class="muted small">' + m.desc + '</span></span>'));
    });
    $('#set-automem').checked = !!Settings.data.autoMemory;
    $('#set-web').checked = !!Settings.data.webSearch;
    $('#set-voice-send').checked = !!Settings.data.voiceAutoSend;
    $('#set-voice-read').checked = !!Settings.data.voiceRead;
    if (document.activeElement !== $('#set-consignes')) $('#set-consignes').value = Settings.data.consignes || '';

    const month = new Date().toISOString().slice(0, 7);
    const u = Settings.data.usage[month] || {};
    let tin = 0, tout = 0, calls = 0, web = 0;
    Object.values(u).forEach((x) => { tin += x.in + x.cacheRead + x.cacheWrite; tout += x.out; calls += x.calls; web += x.web || 0; });
    $('#usage').innerHTML = calls
      ? 'Ce mois-ci : <strong>' + fmtNum(calls) + '</strong> appels, ' + fmtNum(tin) + ' jetons lus, ' + fmtNum(tout) + ' jetons écrits' + (web ? ', ' + web + ' recherches web' : '') + '.<br><span class="muted">Le coût exact est visible sur console.anthropic.com (menu Usage).</span>'
      : '<span class="muted">Rien ce mois-ci.</span>';
    let v = '';
    try { v = isNative() ? window.ManaenNative.version() : 'version ordinateur'; } catch (e) { v = '?'; }
    const ic = $('#install-card');
    if (ic) ic.style.display = !isNative() && installEvt ? '' : 'none';
    $('#app-version').textContent = 'Manaen ' + v;
  }

  function updateBrand() {
    const m = MODELS.find((x) => x.id === Settings.data.model) || MODELS[0];
    $('#brand-sub').textContent = 'Cerveau : ' + m.name + (Settings.data.webSearch ? ' · Internet' : '');
  }

  async function testKey(key, statusEl) {
    statusEl.className = 'small muted' + (statusEl.classList.contains('center') ? ' center' : '');
    statusEl.textContent = 'Test de la clé…';
    const old = Settings.data.apiKey;
    Settings.data.apiKey = key;
    try {
      await callClaude({ model: FAST_MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'Réponds juste : ok' }] }, { noRetry: true });
      Settings.save();
      statusEl.className = 'small ok' + (statusEl.id === 'welcome-status' ? ' center' : '');
      statusEl.textContent = '✔ Clé valide, Manaen est réveillé.';
      return true;
    } catch (e) {
      if (e.status === 401 || e.status === 403) Settings.data.apiKey = old;
      else Settings.save(); // problème réseau ou crédit : on garde la clé
      statusEl.className = 'small bad' + (statusEl.id === 'welcome-status' ? ' center' : '');
      statusEl.textContent = '✖ ' + e.message;
      return false;
    }
  }

  // Sauvegarde / restauration
  async function exportAll() {
    const docs = [];
    for (const d of Docs.list) docs.push({ meta: d, chunks: (await DB.get('doc:' + d.id)) || [] });
    const convs = [];
    for (const c of Chats.index) {
      const full = await DB.get('conv:' + c.id);
      if (full) convs.push(full);
    }
    const data = {
      app: 'manaen', version: 2, date: new Date().toISOString(),
      memory: Memory.items,
      docs: docs,
      conversations: convs,
      settings: { model: Settings.data.model, autoMemory: Settings.data.autoMemory, webSearch: Settings.data.webSearch, consignes: Settings.data.consignes }
    };
    const json = JSON.stringify(data);
    const name = 'manaen-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json';
    if (isNative()) {
      window.__onSaved = (ok) => toast(ok ? 'Sauvegarde enregistrée' : 'Sauvegarde annulée');
      window.ManaenNative.saveFile(name, 'application/json', json);
    } else {
      const a = el('a', { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: name });
      document.body.appendChild(a); a.click(); a.remove();
    }
  }

  async function importAll(file) {
    try {
      const data = JSON.parse(await readAsText(file));
      if (data.app !== 'manaen') throw new Error('Ce fichier n\'est pas une sauvegarde Manaen.');
      const ok = await confirmBox('Importer', 'Ajouter ' + (data.memory || []).length + ' infos de mémoire, ' + (data.docs || []).length + ' documents et ' + (data.conversations || []).length + ' discussions ? Les doublons sont ignorés.', 'Importer');
      if (!ok) return;
      for (const m of data.memory || []) {
        if (!Memory.items.find((x) => norm(x.text) === norm(m.text))) {
          Memory.items.push({ id: Memory.nextId(), text: m.text, cat: m.cat || 'Divers', src: m.src || 'moi', ts: m.ts || Date.now() });
        }
      }
      await Memory.save();
      for (const d of data.docs || []) {
        if (Docs.list.find((x) => x.id === d.meta.id || (x.name === d.meta.name && x.chars === d.meta.chars))) continue;
        await DB.set('doc:' + d.meta.id, d.chunks);
        Docs.chunks[d.meta.id] = d.chunks.map((x) => ({ p: x.p, t: x.t, tk: tokens(x.t) }));
        Docs.list.push(d.meta);
      }
      await Docs.saveList();
      let addedConv = 0;
      for (const c of data.conversations || []) {
        if (!c || !c.id || !Array.isArray(c.display) || !c.display.length) continue;
        if (Chats.index.find((x) => x.id === c.id)) continue;
        await DB.set('conv:' + c.id, c);
        Chats.index.push({ id: c.id, title: c.title || 'Discussion', ts: c.ts || Date.now() });
        addedConv++;
      }
      if (addedConv) {
        Chats.index.sort((a, b) => b.ts - a.ts);
        if (Chats.index.length > 200) {
          const old = Chats.index.splice(200);
          for (const o of old) await DB.del('conv:' + o.id);
        }
        await DB.set('convs', Chats.index);
      }
      if (data.settings && data.settings.consignes && !Settings.data.consignes) { Settings.data.consignes = data.settings.consignes; Settings.save(); }
      toast('Import terminé');
      renderMemory(); renderDocs();
    } catch (e) {
      toast(e.message || 'Import impossible', 4000);
    }
  }

  // ============================================================
  //  Feuilles, fenêtres, navigation
  // ============================================================
  function openSheet(id) { $('#' + id).classList.add('open'); }
  function closeSheet(id) { $('#' + id).classList.remove('open'); }
  function openSheets() { return $$('.sheet.open'); }

  let modalResolve = null;
  function modal(title, bodyHtml, okLabel, onOpen) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    $('#modal-ok').textContent = okLabel || 'OK';
    $('#modal').classList.add('open');
    if (onOpen) setTimeout(onOpen, 50);
    return new Promise((res) => { modalResolve = res; });
  }
  function closeModal(v) {
    $('#modal').classList.remove('open');
    if (modalResolve) { const r = modalResolve; modalResolve = null; r(v); }
  }
  function confirmBox(title, html, okLabel) { return modal(title, '<p>' + html + '</p>', okLabel); }

  function openWelcome() {
    $('#welcome-key').value = Settings.key;
    openSheet('sheet-welcome');
  }

  let currentView = 'chat';
  function showView(v) {
    currentView = v;
    $$('.view').forEach((x) => x.classList.toggle('active', x.id === 'view-' + v));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
    $('#btn-new').style.visibility = v === 'chat' ? 'visible' : 'hidden';
    $('#btn-history').style.visibility = v === 'chat' ? 'visible' : 'hidden';
    if (v === 'memory') renderMemory();
    if (v === 'docs') renderDocs();
    if (v === 'settings') renderSettings();
  }

  function renderHistory() {
    const list = $('#history-list');
    list.innerHTML = '';
    if (!Chats.index.length) { list.appendChild(el('div', { class: 'empty-list' }, 'Aucune discussion enregistrée.')); return; }
    Chats.index.forEach((c) => {
      const it = el('div', { class: 'item hist-item' + (Chats.current && Chats.current.id === c.id ? ' current' : '') });
      const top = el('div', { class: 'item-top' }, '<div class="item-text">' + esc(c.title) + '<div class="item-meta">' + fmtDate(c.ts) + '</div></div>');
      const acts = el('div', { class: 'item-actions' });
      acts.appendChild(el('button', {
        onclick: async (ev) => {
          ev.stopPropagation();
          if (await confirmBox('Supprimer ?', esc(c.title), 'Supprimer')) { await Chats.remove(c.id); renderHistory(); renderMessages(); }
        }
      }, '✕'));
      top.appendChild(acts);
      it.appendChild(top);
      it.addEventListener('click', async () => { stopSpeaking(); await Chats.open(c.id); closeSheet('sheet-history'); renderMessages(); });
      list.appendChild(it);
    });
  }

  // Bouton retour Android
  window.__onBack = function () {
    if (speakingIdx != null) { stopSpeaking(); renderMessages(true); return true; }
    if ($('#modal').classList.contains('open')) { closeModal(false); return true; }
    const s = openSheets().filter((x) => x.id !== 'sheet-welcome' || Settings.key);
    if (s.length) { s.forEach((x) => x.classList.remove('open')); return true; }
    if (currentView !== 'chat') { showView('chat'); return true; }
    return false;
  };

  // ============================================================
  //  Démarrage
  // ============================================================
  function bind() {
    $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

    const input = $('#input');
    input.addEventListener('input', () => { autoGrow(); updateSendBtn(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && isDesktop() && !e.isComposing) {
        e.preventDefault();
        if (!busy) $('#btn-send').click();
      }
    });
    input.addEventListener('focus', () => { if (!isDesktop()) document.body.classList.add('keyboard'); });
    input.addEventListener('blur', () => setTimeout(() => document.body.classList.remove('keyboard'), 100));
    $('#btn-send').addEventListener('click', () => {
      if (busy) { cancelled = true; toast('Arrêt après l\'étape en cours…'); return; }
      const t = input.value;
      input.value = '';
      autoGrow();
      sendMessage(t);
    });
    $('#btn-attach').addEventListener('click', () => $('#file-chat').click());
    $('#file-chat').addEventListener('change', (e) => { addChatFiles(Array.from(e.target.files)); e.target.value = ''; });
    $('#btn-learn').addEventListener('click', () => openLearn(input.value.trim()));

    $('#btn-new').addEventListener('click', () => { if (busy) return; stopSpeaking(); Chats.fresh(); renderMessages(); input.focus(); });
    $('#btn-history').addEventListener('click', () => { renderHistory(); openSheet('sheet-history'); });

    $('#btn-learn-save').addEventListener('click', async () => {
      const t = $('#learn-text').value.trim();
      if (!t) { toast('Écris d\'abord ce qu\'il faut retenir.'); return; }
      await Memory.add(t, learnCat, 'moi');
      closeSheet('sheet-learn');
      if ($('#input').value.trim() === t) { $('#input').value = ''; autoGrow(); updateSendBtn(); }
      toast('🧠 Manaen a retenu ça');
      if (currentView === 'memory') renderMemory();
    });

    $('#mem-search').addEventListener('input', renderMemory);
    $('#btn-mem-add').addEventListener('click', () => openLearn(''));

    $('#btn-doc-add').addEventListener('click', () => $('#file-docs').click());
    $('#file-docs').addEventListener('change', (e) => { ingestFiles(Array.from(e.target.files)); e.target.value = ''; });

    $('#btn-key-show').addEventListener('click', () => {
      const k = $('#set-key');
      k.type = k.type === 'password' ? 'text' : 'password';
      $('#btn-key-show').textContent = k.type === 'password' ? 'Voir' : 'Cacher';
    });
    $('#btn-key-save').addEventListener('click', () => testKey($('#set-key').value.trim(), $('#key-status')));
    $('#set-automem').addEventListener('change', (e) => { Settings.data.autoMemory = e.target.checked; Settings.save(); });
    $('#set-web').addEventListener('change', (e) => { Settings.data.webSearch = e.target.checked; Settings.save(); updateBrand(); });
    $('#set-voice-send').addEventListener('change', (e) => { Settings.data.voiceAutoSend = e.target.checked; Settings.save(); });
    $('#set-voice-read').addEventListener('change', (e) => { Settings.data.voiceRead = e.target.checked; Settings.save(); });
    let consTimer;
    $('#set-consignes').addEventListener('input', (e) => {
      clearTimeout(consTimer);
      consTimer = setTimeout(() => { Settings.data.consignes = e.target.value; Settings.save(); $('#consignes-status').textContent = 'Enregistré ✔'; setTimeout(() => { $('#consignes-status').textContent = ''; }, 1500); }, 500);
    });
    $('#btn-mic').addEventListener('click', startVoice);
    $('#btn-export').addEventListener('click', exportAll);
    $('#btn-import').addEventListener('click', () => $('#file-import').click());
    $('#file-import').addEventListener('change', (e) => { if (e.target.files[0]) importAll(e.target.files[0]); e.target.value = ''; });
    $('#btn-clear-chats').addEventListener('click', async () => {
      if (!await confirmBox('Effacer les discussions ?', 'Toutes les discussions seront supprimées. La mémoire et les documents sont gardés.', 'Effacer')) return;
      for (const c of Chats.index) await DB.del('conv:' + c.id);
      Chats.index = [];
      await DB.set('convs', []);
      Chats.fresh();
      renderMessages();
      toast('Discussions effacées');
    });
    $('#btn-clear-all').addEventListener('click', async () => {
      if (!await confirmBox('Tout effacer ?', 'Mémoire, documents, discussions et clé : Manaen repart de zéro. Pense à exporter une sauvegarde avant.', 'Tout effacer')) return;
      await DB.clear();
      localStorage.clear();
      location.reload();
    });

    $('#btn-welcome-go').addEventListener('click', async () => {
      const k = $('#welcome-key').value.trim();
      if (!k) { $('#welcome-status').textContent = 'Colle ta clé ci-dessus.'; return; }
      const ok = await testKey(k, $('#welcome-status'));
      if (ok) setTimeout(() => closeSheet('sheet-welcome'), 900);
    });

    $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('.sheet').classList.remove('open')));
    $$('.sheet').forEach((s) => s.addEventListener('click', (e) => { if (e.target === s && (s.id !== 'sheet-welcome' || Settings.key)) s.classList.remove('open'); }));
    $('#modal-ok').addEventListener('click', () => closeModal(true));
    $('#modal-cancel').addEventListener('click', () => closeModal(false));

    // Liens externes : navigateur du téléphone
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-ext], a[href^="http"]');
      if (!a) return;
      e.preventDefault();
      if (isNative()) window.ManaenNative.openUrl(a.href);
      else window.open(a.href, '_blank');
    });
  }

  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvt = e;
    if (currentView === 'settings') renderSettings();
    const b = $('#btn-install-top');
    if (b) b.style.display = '';
  });
  async function doInstall() {
    if (!installEvt) { toast('Menu du navigateur (⋮) → « Installer Manaen »', 4000); return; }
    installEvt.prompt();
    const r = await installEvt.userChoice;
    if (r && r.outcome === 'accepted') { installEvt = null; toast('Manaen est installé ✔'); }
    renderSettings();
    const b = $('#btn-install-top');
    if (b && !installEvt) b.style.display = 'none';
  }

  async function start() {
    Settings.load();
    if (isDesktop()) document.body.classList.add('desktop');
    if (!isNative() && 'serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    const ib = $('#btn-install'); if (ib) ib.addEventListener('click', doInstall);
    const it = $('#btn-install-top'); if (it) it.addEventListener('click', doInstall);
    bind();
    try {
      await Memory.load();
      await Docs.load();
      await Chats.load();
    } catch (e) {
      toast('Erreur de stockage : ' + e.message, 5000);
    }
    renderMessages();
    updateBrand();
    updateSendBtn();
    if (!Settings.key) openWelcome();
  }

  // Exposé pour les tests
  window.__manaen = { Memory, Docs, Chats, Settings, tokens, chunkPages, splitPagesFromTranscript, windowMessages, sanitize };

  start();
})();
