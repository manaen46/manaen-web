/* Manaen — stockage sur l'appareil : réglages, mémoire, documents, discussions, sauvegarde. */
(function () {
  'use strict';
  const M = window.M;
  const { norm, uid } = M.util;
  const CFG = M.config;

  // ---------------- Base IndexedDB (clé → valeur) ----------------
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
        const req = fn(t.objectStore('kv'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      }));
    }
    return {
      get: (k) => tx('readonly', (s) => s.get(k)),
      set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
      del: (k) => tx('readwrite', (s) => s.delete(k)),
      clear: () => tx('readwrite', (s) => s.clear())
    };
  })();

  // ---------------- Réglages (localStorage) ----------------
  const DEFAULTS = {
    apiKey: '', model: CFG.models[0].id, autoMemory: true, webSearch: false,
    voiceAutoSend: true, voiceRead: true, consignes: '', usage: {}, deepThinking: false, noThinkingParam: false
  };
  const Settings = {
    data: {},
    load() {
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem('manaen.settings') || '{}'); } catch (e) { /* illisible */ }
      this.data = Object.assign({}, DEFAULTS, saved);
    },
    save() {
      try { localStorage.setItem('manaen.settings', JSON.stringify(this.data)); } catch (e) { /* plein */ }
    },
    set(k, v) { this.data[k] = v; this.save(); },
    get key() { return (this.data.apiKey || '').trim(); },
    trackUsage(model, u) {
      if (!u) return;
      const month = new Date().toISOString().slice(0, 7);
      const byModel = (this.data.usage[month] = this.data.usage[month] || {});
      const m = (byModel[model] = byModel[model] || { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, calls: 0, web: 0 });
      m.in += u.input_tokens || 0;
      m.out += u.output_tokens || 0;
      m.cacheRead += u.cache_read_input_tokens || 0;
      m.cacheWrite += u.cache_creation_input_tokens || 0;
      m.calls += 1;
      m.web += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
      this.save();
    },
    monthUsage() {
      const u = this.data.usage[new Date().toISOString().slice(0, 7)] || {};
      const t = { read: 0, cached: 0, written: 0, calls: 0, web: 0 };
      Object.values(u).forEach((x) => { t.read += x.in + x.cacheRead + x.cacheWrite; t.cached += x.cacheRead; t.written += x.out; t.calls += x.calls; t.web += x.web || 0; });
      return t;
    }
  };

  // ---------------- Mémoire permanente ----------------
  const Memory = {
    items: [],
    async load() {
      const v = await DB.get('memory');
      if (Array.isArray(v)) { this.items = v; return; }
      this.items = CFG.seedMemory.map(([text, cat], i) => ({ id: 'm' + (i + 1), text, cat, src: 'moi', ts: Date.now() }));
      await this.save();
    },
    save() { return DB.set('memory', this.items); },
    find(id) { return this.items.find((m) => m.id === id); },
    nextId() {
      const max = this.items.reduce((mx, m) => Math.max(mx, parseInt(String(m.id).slice(1), 10) || 0), 0);
      return 'm' + (max + 1);
    },
    async add(text, cat, src) {
      text = String(text || '').trim();
      if (!text) return null;
      const dup = this.items.find((m) => norm(m.text) === norm(text));
      if (dup) return dup;
      const it = { id: this.nextId(), text, cat: CFG.categories.includes(cat) ? cat : 'Divers', src: src || 'moi', ts: Date.now() };
      this.items.push(it);
      await this.save();
      return it;
    },
    async update(id, text, cat) {
      const it = this.find(id);
      if (!it) return null;
      if (text != null) it.text = String(text).trim();
      if (cat) it.cat = cat;
      it.ts = Date.now();
      await this.save();
      return it;
    },
    async remove(id) {
      const before = this.items.length;
      this.items = this.items.filter((m) => m.id !== id);
      await this.save();
      return this.items.length !== before;
    },
    // Texte envoyé au cerveau, rangé par catégorie
    forPrompt() {
      if (!this.items.length) return '(vide pour l\'instant)';
      let out = CFG.categories.map((c) => {
        const list = this.items.filter((m) => m.cat === c);
        return list.length ? '## ' + c + '\n' + list.map((m) => '- [' + m.id + '] ' + m.text).join('\n') : '';
      }).filter(Boolean).join('\n\n');
      if (out.length > 40000) out = out.slice(out.length - 40000); // garde-fou de taille
      return out;
    }
  };

  // ---------------- Documents + recherche par mots-clés ----------------
  const STOP = new Set(('les des une est que qui dans pour par sur avec pas plus son ses aux du de la le un et en au ce cette ces ou il elle on nous vous ils elles se sa leur leurs mais comme tout tous toute toutes être avoir fait faire peut doit sont été très aussi entre sans sous chez dont quoi quel quelle quels quelles comment combien quand pourquoi est-ce ça cela the and for are with this that from').split(' '));

  function tokens(s) {
    return norm(s).split(/[^a-z0-9₂²³]+/)
      .filter((w) => w.length >= 2 && !STOP.has(w))
      .map((w) => (w.length > 4 ? w.replace(/(s|x)$/, '') : w)); // pluriels simples
  }

  // Découpe les pages en morceaux d'environ 1 400 caractères qui se chevauchent un peu
  function chunkPages(pages) {
    const SIZE = 1400, OVER = 200;
    const out = [];
    pages.forEach((pg) => {
      const text = String(pg.text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (!text) return;
      if (text.length <= SIZE + 300) { out.push({ p: pg.p, t: text }); return; }
      for (let i = 0; i < text.length;) {
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

  const indexChunks = (chunks) => chunks.map((x) => ({ p: x.p, t: x.t, tk: tokens(x.t) }));

  const Docs = {
    list: [],    // métadonnées : {id, name, type, pages, chars, method, summary, ts}
    chunks: {},  // id → [{p, t, tk}]
    async load() {
      this.list = (await DB.get('docs')) || [];
      for (const d of this.list) this.chunks[d.id] = indexChunks((await DB.get('doc:' + d.id)) || []);
    },
    saveList() { return DB.set('docs', this.list); },
    async add(meta, pages) {
      const chunks = chunkPages(pages);
      await DB.set('doc:' + meta.id, chunks);
      this.chunks[meta.id] = indexChunks(chunks);
      this.list.unshift(meta);
      await this.saveList();
    },
    async addRaw(meta, chunks) {
      await DB.set('doc:' + meta.id, chunks);
      this.chunks[meta.id] = indexChunks(chunks);
      this.list.push(meta);
    },
    async remove(id) {
      this.list = this.list.filter((d) => d.id !== id);
      delete this.chunks[id];
      await DB.del('doc:' + id);
      await this.saveList();
    },
    // Classement de type BM25 : les morceaux qui contiennent les mots rares de la question passent devant
    search(query, k) {
      const q = Array.from(new Set(tokens(query)));
      if (!q.length) return [];
      const all = [];
      const df = {};
      this.list.forEach((d) => (this.chunks[d.id] || []).forEach((c) => {
        const set = new Set(c.tk);
        q.forEach((w) => { if (set.has(w)) df[w] = (df[w] || 0) + 1; });
        all.push({ d, c });
      }));
      const N = all.length;
      if (!N) return [];
      const res = [];
      all.forEach(({ d, c }) => {
        const tf = {};
        c.tk.forEach((w) => { tf[w] = (tf[w] || 0) + 1; });
        const len = c.tk.length || 1;
        let score = 0, hits = 0;
        q.forEach((w) => {
          if (!tf[w]) return;
          hits++;
          const idf = Math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5));
          score += idf * (tf[w] * 2.2) / (tf[w] + 1.2 * (0.25 + 0.75 * len / 220));
        });
        if (score <= 0) return;
        score *= 1 + hits / q.length;
        const dn = norm(d.name);
        q.forEach((w) => { if (dn.includes(w)) score *= 1.15; }); // bonus si le nom du document correspond
        res.push({ doc: d, page: c.p, text: c.t, score });
      });
      return res.sort((a, b) => b.score - a.score).slice(0, k || 6);
    },
    excerpts(results, budget) {
      let used = 0;
      const parts = [];
      for (const r of results) {
        const t = '<extrait document="' + r.doc.name + '"' + (r.page ? ' page="' + r.page + '"' : '') + '>\n' + r.text + '\n</extrait>';
        if (used + t.length > budget) break;
        used += t.length;
        parts.push(t);
      }
      return parts.join('\n\n');
    },
    forPrompt() {
      if (!this.list.length) return 'Aucun document pour l\'instant.';
      return this.list.map((d) => '- « ' + d.name + ' » (' + (d.pages ? d.pages + ' p.' : d.type) + ')' +
        (d.summary ? ' : ' + d.summary.replace(/\s+/g, ' ').slice(0, 300) : '')).join('\n');
    }
  };

  // ---------------- Discussions ----------------
  // Une discussion : {id, title, ts, display: [messages affichés], api: [messages envoyés au cerveau]}
  const Chats = {
    index: [],     // [{id, title, ts}], la plus récente d'abord
    current: null,
    async load() {
      this.index = (await DB.get('convs')) || [];
      const last = localStorage.getItem('manaen.current');
      if (last && this.index.find((c) => c.id === last)) this.current = await DB.get('conv:' + last);
      if (!this.current) this.current = this.blank();
    },
    blank() { return { id: uid(), title: '', ts: Date.now(), display: [], api: [] }; },
    fresh() { this.current = this.blank(); localStorage.removeItem('manaen.current'); },
    async trim() {
      this.index.sort((a, b) => b.ts - a.ts);
      for (const o of this.index.splice(CFG.maxConversations)) await DB.del('conv:' + o.id);
      await DB.set('convs', this.index);
    },
    async save() {
      const c = this.current;
      if (!c.display.length) return;
      c.ts = Date.now();
      await DB.set('conv:' + c.id, c);
      this.index = this.index.filter((x) => x.id !== c.id);
      this.index.unshift({ id: c.id, title: c.title || 'Discussion', ts: c.ts });
      await this.trim();
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
    async clear() {
      for (const c of this.index) await DB.del('conv:' + c.id);
      this.index = [];
      await DB.set('convs', []);
      this.fresh();
    }
  };

  // ---------------- Sauvegarde complète (fichier JSON) ----------------
  const Backup = {
    async build() {
      const docs = [];
      for (const d of Docs.list) docs.push({ meta: d, chunks: (await DB.get('doc:' + d.id)) || [] });
      const conversations = [];
      for (const c of Chats.index) {
        const full = await DB.get('conv:' + c.id);
        if (full) conversations.push(full);
      }
      const s = Settings.data;
      return {
        app: 'manaen', version: 2, date: new Date().toISOString(),
        memory: Memory.items, docs, conversations,
        settings: { model: s.model, autoMemory: s.autoMemory, webSearch: s.webSearch, consignes: s.consignes }
      };
    },
    summary(data) {
      return { memory: (data.memory || []).length, docs: (data.docs || []).length, conversations: (data.conversations || []).length };
    },
    // Fusionne une sauvegarde : rien n'est écrasé, les doublons sont ignorés
    async merge(data) {
      if (!data || data.app !== 'manaen') throw new Error('Ce fichier n\'est pas une sauvegarde Manaen.');
      for (const m of data.memory || []) {
        if (m && m.text && !Memory.items.find((x) => norm(x.text) === norm(m.text))) {
          Memory.items.push({ id: Memory.nextId(), text: m.text, cat: m.cat || 'Divers', src: m.src || 'moi', ts: m.ts || Date.now() });
        }
      }
      await Memory.save();
      for (const d of data.docs || []) {
        if (!d || !d.meta || Docs.list.find((x) => x.id === d.meta.id || (x.name === d.meta.name && x.chars === d.meta.chars))) continue;
        await Docs.addRaw(d.meta, d.chunks || []);
      }
      await Docs.saveList();
      let added = 0;
      for (const c of data.conversations || []) {
        if (!c || !c.id || !Array.isArray(c.display) || !c.display.length || Chats.index.find((x) => x.id === c.id)) continue;
        await DB.set('conv:' + c.id, c);
        Chats.index.push({ id: c.id, title: c.title || 'Discussion', ts: c.ts || Date.now() });
        added++;
      }
      if (added) await Chats.trim();
      if (data.settings && data.settings.consignes && !Settings.data.consignes) Settings.set('consignes', data.settings.consignes);
    },
    async wipe() {
      await DB.clear();
      localStorage.clear();
    }
  };

  M.store = { DB, Settings, Memory, Docs, Chats, Backup, tokens, chunkPages };
})();
