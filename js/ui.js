/* Manaen — interface : discussion, mémoire, documents, réglages, fenêtres. */
(function () {
  'use strict';
  const M = window.M;
  const CFG = M.config;
  const { $, $$, el, esc, toast, fmtDate, fmtNum, norm, readFile } = M.util;
  const P = M.platform;
  const { Settings, Memory, Docs, Chats, Backup } = M.store;

  const state = {
    view: 'chat',
    busy: false,
    cancelled: false,
    attachments: [],     // pièces jointes en attente d'envoi
    speakingIdx: null,   // réponse en cours de lecture à voix haute
    memFilter: 'Tout',
    learnCat: 'Technique',
    installEvt: null,    // installation sur PC proposée par le navigateur
    ingesting: false
  };

  // ======================================================================
  //  Fenêtres : feuilles du bas, boîte de dialogue
  // ======================================================================
  const openSheet = (id) => $('#' + id).classList.add('open');
  const closeSheet = (id) => $('#' + id).classList.remove('open');

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
  const confirmBox = (title, html, okLabel) => modal(title, '<p>' + html + '</p>', okLabel);

  function openWelcome() {
    $('#welcome-key').value = Settings.key;
    openSheet('sheet-welcome');
  }

  function showView(v) {
    state.view = v;
    $$('.view').forEach((x) => x.classList.toggle('active', x.id === 'view-' + v));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
    $('#btn-new').style.visibility = v === 'chat' ? 'visible' : 'hidden';
    $('#btn-history').style.visibility = v === 'chat' ? 'visible' : 'hidden';
    ({ memory: renderMemory, docs: renderDocs, settings: renderSettings }[v] || (() => {}))();
  }

  function updateBrand() {
    const m = CFG.models.find((x) => x.id === Settings.data.model) || CFG.models[0];
    $('#brand-sub').textContent = 'Cerveau : ' + m.name + (Settings.data.webSearch ? ' · Internet' : '');
  }

  // ======================================================================
  //  Discussion
  // ======================================================================
  function renderEmpty(box) {
    const h = new Date().getHours();
    const me = Memory.items.map((m) => m.text.match(/m'appelle\s+([\wÀ-ÿ-]+)/i)).find(Boolean);
    const e = el('div', { class: 'empty' },
      '<div class="logo big"><span class="m-cold"></span><span class="m-warm"></span></div>' +
      '<h2>' + (h < 6 || h >= 18 ? 'Bonsoir' : 'Bonjour') + (me ? ' ' + esc(me[1]) : '') + ' 👋</h2>' +
      '<p class="muted">Clim, chauffage, froid, plomberie, bâtiment, cours… Pose ta question, envoie une photo de plaque ou de code défaut, ou apprends-moi quelque chose avec l\'ampoule.</p>');
    const sg = el('div', { class: 'suggest' });
    CFG.suggestions.forEach(([tag, q]) => sg.appendChild(el('button', {
      onclick: () => { setInput(q); $('#input').focus(); }
    }, '<span class="tag">' + tag + '</span>' + esc(q))));
    e.appendChild(sg);
    box.appendChild(e);
  }

  function renderUserMessage(m, wrap) {
    if (m.images && m.images.length) {
      const im = el('div', { class: 'msg-imgs' });
      m.images.forEach((t) => im.appendChild(el('img', { src: t })));
      wrap.appendChild(im);
    }
    (m.files || []).forEach((f) => wrap.appendChild(el('div', { class: 'msg-file' }, '📄 ' + esc(f))));
    if (m.text) wrap.appendChild(el('div', { class: 'bubble' }, esc(m.text)));
  }

  function renderAssistantMessage(m, idx, wrap) {
    wrap.appendChild(el('div', { class: 'bubble' }, m.error ? '⚠️ ' + esc(m.text) : window.MD.render(m.text)));
    (m.mem || []).forEach((t) => wrap.appendChild(el('div', { class: 'mem-chip' }, '🧠 ' + esc(t))));
    (m.files || []).forEach((f) => {
      const card = el('div', { class: 'file-card' }, '<div class="doc-icon xl">XLS</div><div class="grow"><div class="doc-name">' + esc(f.name) + '</div><div class="muted small">Tableur Excel avec formules</div></div>');
      card.appendChild(el('button', { class: 'btn small-btn', onclick: () => Exports.xlsx(f.name, f.spec) }, 'Enregistrer'));
      wrap.appendChild(card);
    });
    if (m.sources && m.sources.length) {
      const s = el('div', { class: 'sources' });
      m.sources.forEach((x) => s.appendChild(el('a', { href: x.url, 'data-ext': '1' }, '🔗 ' + esc(x.title))));
      wrap.appendChild(s);
    }
    const acts = el('div', { class: 'msg-actions' });
    const btn = (label, fn, cls) => acts.appendChild(el('button', cls ? { class: cls, onclick: fn } : { onclick: fn }, label));
    if (m.error) {
      if (m.retry != null) btn('↻ Réessayer', () => retry(idx));
    } else {
      const speaking = state.speakingIdx === idx;
      btn(speaking ? '⏹ Stop' : '🔊 Lire', () => toggleSpeak(idx), 'speak-btn' + (speaking ? ' on' : ''));
      btn('Copier', () => copyText(m.text));
      if (window.Files.tablesFromMarkdown(m.text).length) btn('📊 Excel', () => Exports.tables(idx));
      btn('📝 Word', () => Exports.word(idx));
      btn('📄 PDF', () => Exports.pdf(idx));
    }
    wrap.appendChild(acts);
  }

  function renderMessages(keepScroll) {
    const box = $('#messages');
    const prevScroll = box.scrollTop;
    box.innerHTML = '';
    const conv = Chats.current;
    if (!conv.display.length) { renderEmpty(box); return; }
    conv.display.forEach((m, idx) => {
      const wrap = el('div', { class: 'msg ' + m.role + (m.error ? ' error' : '') });
      if (m.role === 'user') renderUserMessage(m, wrap);
      else renderAssistantMessage(m, idx, wrap);
      box.appendChild(wrap);
    });
    if (keepScroll) box.scrollTop = prevScroll;
    else requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  }

  function showStatus(text) {
    const box = $('#messages');
    const s = el('div', { class: 'status-line' }, '<span class="dots"><span></span><span></span><span></span></span><span class="t"></span>');
    const t = $('.t', s);
    t.textContent = text;
    box.appendChild(s);
    box.scrollTop = box.scrollHeight;
    return { set: (x) => { t.textContent = x; }, remove: () => s.remove() };
  }

  function setBusy(b) {
    state.busy = b;
    const s = $('#btn-send');
    s.classList.toggle('stop', b);
    s.innerHTML = b
      ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
    updateSendBtn();
  }
  function updateSendBtn() {
    $('#btn-send').disabled = !state.busy && !$('#input').value.trim() && !state.attachments.length;
  }
  function autoGrow() {
    const t = $('#input');
    t.style.height = 'auto';
    t.style.height = Math.min(140, t.scrollHeight) + 'px';
  }
  function setInput(v) {
    $('#input').value = v;
    autoGrow();
    updateSendBtn();
  }

  // Envoie une question et affiche la réponse
  async function send(text, viaVoice) {
    text = (text || '').trim();
    if (state.busy || (!text && !state.attachments.length)) return;
    if (!Settings.key) { openWelcome(); return; }

    const conv = Chats.current;
    const atts = state.attachments;
    state.attachments = [];
    renderAttachments();

    conv.display.push({
      role: 'user', text,
      images: atts.filter((a) => a.kind === 'image').map((a) => a.thumb),
      files: atts.filter((a) => a.kind === 'pdf').map((a) => a.name)
    });
    if (!conv.title) conv.title = (text || (atts[0] && atts[0].name) || 'Discussion').slice(0, 60);
    const content = atts.map((a) => (a.kind === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: a.media, data: a.data } }
      : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name }));
    content.push({ type: 'text', text: text || 'Analyse ce que je t\'envoie.' });

    renderMessages();
    setBusy(true);
    P.busy(true, 'Manaen rédige : « ' + (text.length > 50 ? text.slice(0, 50) + '…' : text || 'ta pièce jointe') + ' »');
    const status = showStatus('Manaen réfléchit…');
    const voiceMode = !!viaVoice && !!Settings.data.voiceRead;
    let speakIdx = null;
    try {
      const r = await M.brain.respond(conv, content, { voice: voiceMode, onStatus: status.set, isCancelled: () => state.cancelled });
      conv.display.push({ role: 'assistant', text: r.text, mem: r.mem, sources: r.sources, files: r.files });
      if (voiceMode && !r.cancelled) speakIdx = conv.display.length - 1;
      if (r.mem.length && state.view === 'memory') renderMemory();
    } catch (e) {
      conv.display.push({ role: 'assistant', error: true, text: e.message || String(e), retry: text });
    } finally {
      status.remove();
      setBusy(false);
      state.cancelled = false;
      await Chats.save();
      renderMessages();
      if (speakIdx != null) toggleSpeak(speakIdx);
      const last = conv.display[conv.display.length - 1];
      P.busy(false, last.error ? 'Problème : ' + last.text : preview(last.text));
    }
  }

  // Début de réponse en texte simple, pour la notification « réponse prête »
  function preview(md) {
    const t = M.voice.speechText(md).replace(/\s+/g, ' ').trim();
    return t.length > 160 ? t.slice(0, 157) + '…' : t;
  }

  function retry(idx) {
    const m = Chats.current.display[idx];
    Chats.current.display.splice(idx - 1, 2); // la question et l'erreur
    renderMessages();
    send(m.retry);
  }

  function copyText(t) {
    const done = () => toast('Copié');
    const fallback = () => {
      const ta = el('textarea');
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Copie impossible'); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback);
    else fallback();
  }

  // ---------------- Pièces jointes ----------------
  async function addAttachments(files) {
    for (const f of files) {
      try { state.attachments.push(await M.ingest.prepareAttachment(f)); } catch (e) { toast(e.message || 'Fichier illisible : ' + f.name, 4000); }
    }
    renderAttachments();
  }
  function renderAttachments() {
    const row = $('#attach-row');
    row.innerHTML = '';
    state.attachments.forEach((a, i) => {
      const it = el('div', { class: 'att' }, (a.kind === 'image' ? '<img src="' + a.thumb + '">' : '<div class="pdf">PDF</div>') + '<span>' + esc(a.name) + '</span>');
      it.appendChild(el('button', { onclick: () => { state.attachments.splice(i, 1); renderAttachments(); } }, '✕'));
      row.appendChild(it);
    });
    updateSendBtn();
  }

  // ---------------- Voix ----------------
  function stopSpeaking() {
    M.voice.stop();
    state.speakingIdx = null;
  }
  function toggleSpeak(idx) {
    const wasThis = state.speakingIdx === idx;
    stopSpeaking();
    if (!wasThis) {
      const m = Chats.current.display[idx];
      if (m && m.role === 'assistant' && !m.error) {
        const ok = M.voice.speak(m.text, () => { state.speakingIdx = null; renderMessages(true); });
        if (ok) state.speakingIdx = idx;
        else toast('Voix française indisponible : installe « Synthèse vocale Google » dans les réglages du téléphone.', 5000);
      }
    }
    renderMessages(true);
  }
  function dictate() {
    if (state.busy) return;
    stopSpeaking();
    const mic = $('#btn-mic');
    const started = M.voice.listen((text, err) => {
      mic.classList.remove('on');
      if (err === 'indisponible') { toast('Pas de reconnaissance vocale sur ce téléphone : installe ou active l\'appli Google.', 5000); return; }
      if (!text) return;
      text = text.charAt(0).toUpperCase() + text.slice(1);
      const current = $('#input').value.trim();
      const full = current ? current + ' ' + text : text;
      if (Settings.data.voiceAutoSend) { setInput(''); send(full, true); } else setInput(full);
    });
    if (!started) { toast('Dictée indisponible ici.'); return; }
    if (!P.isNative()) mic.classList.add('on');
  }

  // ---------------- Exports ----------------
  const MIME = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  const fileSafe = (t) => t.replace(/[\\/:*?"<>|…]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Manaen';

  // Titre d'une réponse : son premier titre, sinon la question posée
  function titleFor(idx) {
    const conv = Chats.current;
    const h = (conv.display[idx].text.match(/^#{1,3}\s+(.+)$/m) || [])[1];
    let q = '';
    for (let k = idx - 1; k >= 0 && !q; k--) if (conv.display[k].role === 'user') q = conv.display[k].text;
    const t = (h || q || conv.title || 'Manaen').replace(/[*_`#]/g, '').trim();
    return t.length > 70 ? t.slice(0, 67).trim() + '…' : t;
  }

  const Exports = {
    xlsx(name, spec) {
      try { P.saveFile(name, MIME.xlsx, window.Files.xlsx(spec), 'Fichier'); } catch (e) { toast('Fichier impossible : ' + e.message, 4000); }
    },
    tables(idx) {
      const rows = window.Files.tablesFromMarkdown(Chats.current.display[idx].text);
      this.xlsx(fileSafe(titleFor(idx)) + '.xlsx', rows.map((r, i) => ({
        nom: 'Tableau ' + (i + 1),
        lignes: r.map((line, ri) => (ri === 0 ? line.map((c) => c.replace(/\*\*/g, '')) : line.map(window.Files.smartCell)))
      })));
    },
    word(idx) {
      const t = titleFor(idx);
      try { P.saveFile(fileSafe(t) + '.docx', MIME.docx, window.Files.docx(t, Chats.current.display[idx].text), 'Document'); } catch (e) { toast('Word impossible : ' + e.message, 4000); }
    },
    pdf(idx) {
      const t = titleFor(idx);
      const html = window.Files.printHtml(t, Chats.current.display[idx].text);
      if (P.isNative()) {
        toast('Choisis « Enregistrer au format PDF » en haut', 3500);
        window.ManaenNative.printHtml(html, fileSafe(t));
        return;
      }
      const w = window.open('', '_blank');
      if (!w) { toast('Fenêtre bloquée'); return; }
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 400);
    }
  };

  // ---------------- Historique ----------------
  function renderHistory() {
    const list = $('#history-list');
    list.innerHTML = '';
    if (!Chats.index.length) { list.appendChild(el('div', { class: 'empty-list' }, 'Aucune discussion enregistrée.')); return; }
    Chats.index.forEach((c) => {
      const it = el('div', { class: 'item hist-item' + (Chats.current.id === c.id ? ' current' : '') });
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

  // ======================================================================
  //  Mémoire
  // ======================================================================
  function renderMemory() {
    const f = $('#mem-filters');
    f.innerHTML = '';
    ['Tout'].concat(CFG.categories).forEach((c) => {
      const n = c === 'Tout' ? Memory.items.length : Memory.items.filter((m) => m.cat === c).length;
      f.appendChild(el('button', { class: 'chip' + (state.memFilter === c ? ' on' : ''), onclick: () => { state.memFilter = c; renderMemory(); } }, esc(c) + ' · ' + n));
    });
    const q = norm($('#mem-search').value);
    const list = $('#mem-list');
    list.innerHTML = '';
    const items = Memory.items
      .filter((m) => (state.memFilter === 'Tout' || m.cat === state.memFilter) && (!q || norm(m.text).includes(q)))
      .sort((a, b) => b.ts - a.ts);
    if (!items.length) { list.appendChild(el('div', { class: 'empty-list' }, q ? 'Rien trouvé.' : 'Rien ici pour l\'instant.')); return; }
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
      it.appendChild(el('div', { class: 'item-meta' },
        '<span class="badge">' + esc(m.cat) + '</span>' +
        (m.src === 'auto' ? '<span class="badge auto">retenu seul</span>' : '<span class="badge moi">appris par toi</span>') +
        '<span>' + fmtDate(m.ts) + '</span>'));
      list.appendChild(it);
    });
  }

  async function editMemory(m) {
    const body = '<textarea id="mem-edit" rows="5">' + esc(m.text) + '</textarea><select id="mem-cat">' +
      CFG.categories.map((c) => '<option' + (c === m.cat ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>';
    if (!(await modal('Modifier', body, 'Enregistrer', () => $('#mem-edit').focus()))) return;
    const t = $('#mem-edit').value.trim();
    if (t) await Memory.update(m.id, t, $('#mem-cat').value);
    else await Memory.remove(m.id);
    renderMemory();
  }

  function openLearn(prefill) {
    $('#learn-text').value = prefill || '';
    const c = $('#learn-cats');
    c.innerHTML = '';
    CFG.categories.forEach((cat) => c.appendChild(el('button', {
      class: 'chip' + (cat === state.learnCat ? ' on' : ''),
      onclick: (e) => { state.learnCat = cat; $$('#learn-cats .chip').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); }
    }, cat)));
    openSheet('sheet-learn');
    setTimeout(() => $('#learn-text').focus(), 250);
  }

  async function saveLearn() {
    const t = $('#learn-text').value.trim();
    if (!t) { toast('Écris d\'abord ce qu\'il faut retenir.'); return; }
    await Memory.add(t, state.learnCat, 'moi');
    closeSheet('sheet-learn');
    if ($('#input').value.trim() === t) setInput('');
    toast('🧠 Manaen a retenu ça');
    if (state.view === 'memory') renderMemory();
  }

  // ======================================================================
  //  Documents
  // ======================================================================
  function renderDocs() {
    const list = $('#doc-list');
    list.innerHTML = '';
    if (!Docs.list.length) {
      list.appendChild(el('div', { class: 'empty-list' }, 'Aucun document. Ajoute une notice constructeur, un DTU, un cours ou ton référentiel, et Manaen s\'en servira pour te répondre.'));
      return;
    }
    Docs.list.forEach((d) => {
      const icon = { PDF: 'PDF', Photo: 'IMG' }[d.type] || 'TXT';
      const row = el('div', { class: 'doc-row' },
        '<div class="doc-icon">' + icon + '</div><div class="grow"><div class="doc-name">' + esc(d.name) + '</div>' +
        (d.summary ? '<div class="doc-sum">' + esc(d.summary) + '</div>' : '') +
        '<div class="item-meta">' + (d.pages ? '<span>' + d.pages + ' pages</span>' : '') + '<span>' + fmtNum(d.chars / 5.5) + ' mots</span>' +
        (d.method === 'scan' || d.method === 'claude' ? '<span class="badge">lu par Manaen</span>' : '') +
        '<span>' + fmtDate(d.ts) + '</span></div></div>');
      const acts = el('div', { class: 'item-actions' });
      acts.appendChild(el('button', {
        onclick: async () => {
          if (await confirmBox('Supprimer ?', 'Manaen ne pourra plus consulter « ' + esc(d.name) + ' ».', 'Supprimer')) { await Docs.remove(d.id); renderDocs(); }
        }
      }, '✕'));
      row.appendChild(acts);
      const it = el('div', { class: 'item' });
      it.appendChild(row);
      list.appendChild(it);
    });
  }

  async function importDocs(files) {
    if (!files.length) return;
    if (!Settings.key) { openWelcome(); return; }
    if (state.ingesting) { toast('Un document est déjà en cours de lecture.'); return; }
    state.ingesting = true;
    P.busy(true, 'Manaen lit tes documents…');
    const confirmScan = (n) => confirmBox('PDF scanné', 'Ce document est un scan (' + n + ' pages) : Manaen doit le lire page par page avec son cerveau rapide. Ça coûte quelques centimes. On y va ?', 'Lire le scan');
    for (const file of files) {
      const prog = el('div', { class: 'progress' }, '<div><strong>' + esc(file.name) + '</strong></div><div class="muted small msg">Préparation…</div><div class="bar"><div></div></div>');
      $('#doc-progress').prepend(prog);
      const setP = (msg, frac) => {
        $('.msg', prog).textContent = msg;
        if (frac != null && $('.bar > div', prog)) $('.bar > div', prog).style.width = Math.round(Math.min(1, frac) * 100) + '%';
      };
      try {
        await M.ingest.importDocument(file, setP, confirmScan);
        setP('Prêt ✔', 1);
        setTimeout(() => prog.remove(), 1500);
        renderDocs();
      } catch (e) {
        setP('Échec : ' + (e.message || e));
        const bar = $('.bar', prog);
        if (bar) bar.remove();
        prog.classList.add('bad');
        setTimeout(() => prog.remove(), 9000);
      }
    }
    state.ingesting = false;
    P.busy(false, files.length > 1 ? 'Tes ' + files.length + ' documents sont traités.' : 'Ton document « ' + files[0].name + ' » est traité.');
  }

  // ======================================================================
  //  Réglages
  // ======================================================================
  function renderSettings() {
    const s = Settings.data;
    $('#set-key').value = Settings.key;
    const ml = $('#set-model');
    ml.innerHTML = '';
    CFG.models.forEach((m) => ml.appendChild(el('button', {
      class: 'radio' + (s.model === m.id ? ' on' : ''),
      onclick: () => { Settings.set('model', m.id); renderSettings(); updateBrand(); }
    }, '<span class="dot"></span><span><strong>' + m.name + '</strong><br><span class="muted small">' + m.desc + '</span></span>')));
    $('#set-automem').checked = !!s.autoMemory;
    $('#set-web').checked = !!s.webSearch;
    $('#set-voice-send').checked = !!s.voiceAutoSend;
    $('#set-voice-read').checked = !!s.voiceRead;
    if (document.activeElement !== $('#set-consignes')) $('#set-consignes').value = s.consignes || '';

    const u = Settings.monthUsage();
    $('#usage').innerHTML = u.calls
      ? 'Ce mois-ci : <strong>' + fmtNum(u.calls) + '</strong> appels, ' + fmtNum(u.read) + ' jetons lus, ' + fmtNum(u.written) + ' jetons écrits' +
        (u.web ? ', ' + u.web + ' recherches web' : '') + '.<br><span class="muted">Le coût exact est visible sur console.anthropic.com (menu Usage).</span>'
      : '<span class="muted">Rien ce mois-ci.</span>';
    $('#install-card').style.display = !P.isNative() && state.installEvt ? '' : 'none';
    $('#app-version').textContent = 'Manaen ' + P.version();
  }

  async function checkKey(key, statusEl, centered) {
    const cls = (c) => 'small ' + c + (centered ? ' center' : '');
    statusEl.className = cls('muted');
    statusEl.textContent = 'Test de la clé…';
    const r = await M.api.testKey(key);
    statusEl.className = cls(r.ok ? 'ok' : 'bad');
    statusEl.textContent = r.ok ? '✔ Clé valide, Manaen est réveillé.' : '✖ ' + r.message;
    return r.ok;
  }

  async function exportBackup() {
    const json = JSON.stringify(await Backup.build());
    P.saveFile('manaen-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json', json, 'Sauvegarde');
  }

  async function importBackup(file) {
    try {
      const data = JSON.parse(await readFile(file, 'text'));
      if (!data || data.app !== 'manaen') throw new Error('Ce fichier n\'est pas une sauvegarde Manaen.');
      const n = Backup.summary(data);
      if (!(await confirmBox('Importer', 'Ajouter ' + n.memory + ' infos de mémoire, ' + n.docs + ' documents et ' + n.conversations + ' discussions ? Les doublons sont ignorés.', 'Importer'))) return;
      await Backup.merge(data);
      toast('Import terminé');
      renderMemory();
      renderDocs();
    } catch (e) {
      toast(e.message || 'Import impossible', 4000);
    }
  }

  // ---------------- Installation sur ordinateur ----------------
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installEvt = e;
    $('#btn-install-top').style.display = '';
    if (state.view === 'settings') renderSettings();
  });
  async function install() {
    if (!state.installEvt) { toast('Menu du navigateur (⋮) → « Installer Manaen »', 4000); return; }
    state.installEvt.prompt();
    const r = await state.installEvt.userChoice;
    if (r && r.outcome === 'accepted') { state.installEvt = null; toast('Manaen est installé ✔'); }
    $('#btn-install-top').style.display = state.installEvt ? '' : 'none';
    renderSettings();
  }

  // Bouton retour d'Android : ferme ce qui est ouvert, revient à la discussion
  window.__onBack = function () {
    if (state.speakingIdx != null) { stopSpeaking(); renderMessages(true); return true; }
    if ($('#modal').classList.contains('open')) { closeModal(false); return true; }
    const sheets = $$('.sheet.open').filter((x) => x.id !== 'sheet-welcome' || Settings.key);
    if (sheets.length) { sheets.forEach((x) => x.classList.remove('open')); return true; }
    if (state.view !== 'chat') { showView('chat'); return true; }
    return false;
  };

  // ======================================================================
  //  Branchement des boutons
  // ======================================================================
  function bind() {
    const on = (sel, ev, fn) => $(sel).addEventListener(ev, fn);
    const pickFiles = (inputSel, fn) => on(inputSel, 'change', (e) => { const f = Array.from(e.target.files); e.target.value = ''; fn(f); });
    const toggle = (sel, key, after) => on(sel, 'change', (e) => { Settings.set(key, e.target.checked); if (after) after(); });

    $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

    // Discussion
    const input = $('#input');
    on('#input', 'input', () => { autoGrow(); updateSendBtn(); });
    on('#input', 'keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && P.isDesktop()) { e.preventDefault(); if (!state.busy) $('#btn-send').click(); }
    });
    on('#input', 'focus', () => { if (!P.isDesktop()) document.body.classList.add('keyboard'); });
    on('#input', 'blur', () => setTimeout(() => document.body.classList.remove('keyboard'), 100));
    on('#btn-send', 'click', () => {
      if (state.busy) { state.cancelled = true; toast('Arrêt après l\'étape en cours…'); return; }
      const t = input.value;
      setInput('');
      send(t);
    });
    on('#btn-attach', 'click', () => $('#file-chat').click());
    pickFiles('#file-chat', addAttachments);
    on('#btn-mic', 'click', dictate);
    on('#btn-learn', 'click', () => openLearn(input.value.trim()));
    on('#btn-new', 'click', () => { if (state.busy) return; stopSpeaking(); Chats.fresh(); renderMessages(); input.focus(); });
    on('#btn-history', 'click', () => { renderHistory(); openSheet('sheet-history'); });

    // Mémoire
    on('#btn-learn-save', 'click', saveLearn);
    on('#mem-search', 'input', renderMemory);
    on('#btn-mem-add', 'click', () => openLearn(''));

    // Documents
    on('#btn-doc-add', 'click', () => $('#file-docs').click());
    pickFiles('#file-docs', importDocs);

    // Réglages
    on('#btn-key-show', 'click', () => {
      const k = $('#set-key');
      k.type = k.type === 'password' ? 'text' : 'password';
      $('#btn-key-show').textContent = k.type === 'password' ? 'Voir' : 'Cacher';
    });
    on('#btn-key-save', 'click', () => checkKey($('#set-key').value.trim(), $('#key-status')));
    toggle('#set-automem', 'autoMemory');
    toggle('#set-web', 'webSearch', updateBrand);
    toggle('#set-voice-send', 'voiceAutoSend');
    toggle('#set-voice-read', 'voiceRead');
    let consTimer;
    on('#set-consignes', 'input', (e) => {
      clearTimeout(consTimer);
      consTimer = setTimeout(() => {
        Settings.set('consignes', e.target.value);
        $('#consignes-status').textContent = 'Enregistré ✔';
        setTimeout(() => { $('#consignes-status').textContent = ''; }, 1500);
      }, 500);
    });
    on('#btn-export', 'click', exportBackup);
    on('#btn-import', 'click', () => $('#file-import').click());
    pickFiles('#file-import', (f) => f[0] && importBackup(f[0]));
    on('#btn-clear-chats', 'click', async () => {
      if (!(await confirmBox('Effacer les discussions ?', 'Toutes les discussions seront supprimées. La mémoire et les documents sont gardés.', 'Effacer'))) return;
      await Chats.clear();
      renderMessages();
      toast('Discussions effacées');
    });
    on('#btn-clear-all', 'click', async () => {
      if (!(await confirmBox('Tout effacer ?', 'Mémoire, documents, discussions et clé : Manaen repart de zéro. Pense à exporter une sauvegarde avant.', 'Tout effacer'))) return;
      await Backup.wipe();
      location.reload();
    });
    on('#btn-install', 'click', install);
    on('#btn-install-top', 'click', install);

    // Premier lancement
    on('#btn-welcome-go', 'click', async () => {
      const k = $('#welcome-key').value.trim();
      if (!k) { $('#welcome-status').textContent = 'Colle ta clé ci-dessus.'; return; }
      if (await checkKey(k, $('#welcome-status'), true)) setTimeout(() => closeSheet('sheet-welcome'), 900);
    });

    // Fenêtres
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('.sheet').classList.remove('open')));
    $$('.sheet').forEach((s) => s.addEventListener('click', (e) => {
      if (e.target === s && (s.id !== 'sheet-welcome' || Settings.key)) s.classList.remove('open');
    }));
    on('#modal-ok', 'click', () => closeModal(true));
    on('#modal-cancel', 'click', () => closeModal(false));

    // Liens externes : navigateur du téléphone ou nouvel onglet
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-ext], a[href^="http"]');
      if (!a) return;
      e.preventDefault();
      P.openUrl(a.href);
    });
  }

  function init() {
    if (P.isDesktop()) document.body.classList.add('desktop');
    bind();
    renderMessages();
    updateBrand();
    updateSendBtn();
    if (!Settings.key) openWelcome();
  }

  M.ui = { init, toast };
})();
