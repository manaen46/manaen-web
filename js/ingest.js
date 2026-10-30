/* Manaen — lecture des documents : PDF texte, PDF scannés, photos, fichiers texte. */
(function () {
  'use strict';
  const M = window.M;
  const CFG = M.config;
  const { readFile, bytesToB64, uid } = M.util;
  const api = M.api;

  // ---------------- Images ----------------
  function loadImage(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Image illisible'));
      i.src = src;
    });
  }

  // Réduit une image (JPEG, côté le plus long = max pixels)
  async function resizeImage(dataUrl, max, quality) {
    const img = await loadImage(dataUrl);
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality || 0.85);
  }

  // ---------------- Pièces jointes de la discussion ----------------
  // Renvoie {kind, name, data(base64), media, thumb} ou lève une erreur lisible
  async function prepareAttachment(file) {
    if (file.type.startsWith('image/')) {
      const d = await resizeImage(await readFile(file, 'dataurl'), 1568, 0.85);
      return { kind: 'image', name: file.name, media: 'image/jpeg', data: d.split(',')[1], thumb: await resizeImage(d, 240, 0.7) };
    }
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      if (file.size > 20 * 1024 * 1024) throw new Error('PDF trop gros pour la discussion (20 Mo max). Ajoute-le dans Documents.');
      return { kind: 'pdf', name: file.name, data: bytesToB64(await readFile(file, 'buffer')) };
    }
    throw new Error('Format non pris en charge ici : photo ou PDF.');
  }

  // ---------------- Lecteur PDF (pdf.js, chargé à la demande) ----------------
  let pdfjsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsPromise) {
      pdfjsPromise = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = CFG.pdfjs + 'pdf.min.js';
        s.onload = () => {
          if (!window.pdfjsLib) return rej(new Error('pdf.js absent'));
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = CFG.pdfjs + 'pdf.worker.min.js';
          res(window.pdfjsLib);
        };
        s.onerror = () => { pdfjsPromise = null; rej(new Error('Lecteur PDF non chargé (connexion ?)')); };
        document.head.appendChild(s);
      });
    }
    return pdfjsPromise;
  }

  // ---------------- Lecture par le cerveau (scans, photos) ----------------
  const TRANSCRIBE = 'Transcris fidèlement et intégralement le texte de ces pages, dans l\'ordre, en français tel quel. ' +
    'Commence chaque page par une ligne « === Page N === » (N = numéro indiqué). Reproduis les tableaux en Markdown. ' +
    'Pour les schémas, photos ou plans, écris une courte description entre crochets avec les valeurs et repères lisibles. ' +
    'Ne commente pas, ne résume pas.';
  const DESCRIBE_PHOTO = 'Transcris fidèlement tout le texte visible sur cette image (tableaux en Markdown), puis décris en quelques lignes ce qu\'elle montre d\'un point de vue technique (matériel, schéma, valeurs, références). Ne commente pas.';

  function splitPages(txt, firstPage) {
    const parts = txt.split(/^=== ?Page (\d+) ?===\s*$/m);
    if (parts.length < 3) return [{ p: firstPage || 1, text: txt.trim() }];
    const pages = [];
    if (parts[0].trim()) pages.push({ p: firstPage || 1, text: parts[0].trim() });
    for (let i = 1; i < parts.length; i += 2) pages.push({ p: parseInt(parts[i], 10), text: (parts[i + 1] || '').trim() });
    return pages;
  }

  // images : dataURL JPEG, une par page
  async function readImages(images, firstPage, asPages) {
    const content = [];
    images.forEach((d, i) => {
      if (asPages) content.push({ type: 'text', text: 'Page ' + (firstPage + i) + ' :' });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d.split(',')[1] } });
    });
    content.push({ type: 'text', text: asPages ? TRANSCRIBE : DESCRIBE_PHOTO });
    return api.textOf(await api.call({ model: CFG.fastModel, max_tokens: 8000, messages: [{ role: 'user', content }] }));
  }

  // Secours si pdf.js ne charge pas : le cerveau lit le PDF entier, par parties
  async function readWholePdf(b64, onProgress) {
    const doc = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 }, cache_control: { type: 'ephemeral' } };
    const msgs = [{ role: 'user', content: [doc, { type: 'text', text: TRANSCRIBE + ' Utilise les numéros de page du fichier. Si tu n\'as pas le temps de tout finir, arrête-toi à la fin d\'une page et termine par la ligne <<SUITE>>.' }] }];
    let all = '';
    for (let i = 0; i < 12; i++) {
      onProgress('Lecture par Manaen (partie ' + (i + 1) + ')…');
      const res = await api.call({ model: CFG.fastModel, max_tokens: 16000, messages: msgs });
      const t = api.textOf(res);
      all += '\n' + t.replace(/<<SUITE>>\s*$/, '');
      if (!/<<SUITE>>\s*$/.test(t) && res.stop_reason !== 'max_tokens') break;
      msgs.push({ role: 'assistant', content: t });
      msgs.push({ role: 'user', content: 'Continue la transcription à partir de la page suivante, même format.' });
    }
    return splitPages(all.trim(), 1);
  }

  // confirmScan(nbPages) → Promise<bool> : demande l'accord avant de faire lire un scan (payant)
  async function readPdf(file, onProgress, confirmScan) {
    const buf = await readFile(file, 'buffer');
    let lib = null;
    try { lib = await loadPdfJs(); } catch (e) { /* hors ligne ou bloqué */ }
    if (!lib) {
      if (file.size > 24 * 1024 * 1024) throw new Error('PDF trop gros (24 Mo max).');
      return { pages: await readWholePdf(bytesToB64(buf), onProgress), method: 'claude' };
    }
    const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      pages.push({ p, text: tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('') });
      if (p % 5 === 0) onProgress('Lecture page ' + p + '/' + pdf.numPages + '…', p / pdf.numPages);
    }
    const chars = pages.reduce((s, x) => s + x.text.trim().length, 0);
    if (chars / pdf.numPages >= 80) return { pages, method: 'texte' };

    // Peu de texte : c'est un scan, on fait lire les pages en image
    if (!(await confirmScan(pdf.numPages))) throw new Error('Lecture annulée.');
    const max = Math.min(pdf.numPages, 120);
    const out = [];
    for (let start = 1; start <= max; start += 6) {
      const imgs = [];
      for (let p = start; p < start + 6 && p <= max; p++) {
        const page = await pdf.getPage(p);
        const vp0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(2, 1500 / Math.max(vp0.width, vp0.height)) });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        imgs.push(c.toDataURL('image/jpeg', 0.8));
      }
      onProgress('Lecture du scan : pages ' + start + ' à ' + Math.min(start + 5, max) + ' sur ' + max + '…', start / max);
      splitPages(await readImages(imgs, start, true), start).forEach((x) => out.push(x));
    }
    return { pages: out, method: 'scan' };
  }

  // ---------------- Word, PowerPoint, Excel, OpenDocument ----------------
  // Ces fichiers sont des archives ZIP de XML : on les ouvre et on en extrait le texte.
  async function unzip(buf) {
    const b = new Uint8Array(buf);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Fichier abîmé ou pas au bon format.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    const dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
      entries[name] = { method, csize, local };
      p += 46 + nlen + xlen + clen;
    }
    return {
      names: Object.keys(entries),
      async text(name) {
        const e = entries[name];
        if (!e) return null;
        const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
        const data = b.subarray(start, start + e.csize);
        if (e.method === 0) return dec.decode(data);
        if (typeof DecompressionStream === 'undefined') throw new Error('Ce téléphone ne sait pas ouvrir ce format : enregistre le fichier en PDF.');
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Response(stream).text();
      }
    };
  }

  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const byTag = (node, tag) => Array.from(node.getElementsByTagName(tag));
  const textIn = (node, tag) => byTag(node, tag).map((t) => t.textContent).join('');
  const num = (name) => parseInt((name.match(/(\d+)\.xml$/) || [0, 0])[1], 10);

  function docxText(doc) {
    const body = doc.getElementsByTagName('w:body')[0];
    if (!body) return '';
    const para = (p) => {
      let t = '';
      p.querySelectorAll('*').forEach((n) => {
        if (n.tagName === 'w:t') t += n.textContent;
        else if (n.tagName === 'w:tab') t += '\t';
        else if (n.tagName === 'w:br') t += '\n';
      });
      const style = (p.getElementsByTagName('w:pStyle')[0] || { getAttribute: () => '' }).getAttribute('w:val') || '';
      return /heading|titre|title/i.test(style) && t.trim() ? '## ' + t : t;
    };
    const out = [];
    Array.from(body.children).forEach((n) => {
      if (n.tagName === 'w:p') out.push(para(n));
      else if (n.tagName === 'w:tbl') {
        byTag(n, 'w:tr').forEach((tr) => out.push('| ' + byTag(tr, 'w:tc').map((tc) => byTag(tc, 'w:p').map(para).join(' ').trim()).join(' | ') + ' |'));
        out.push('');
      }
    });
    return out.join('\n');
  }

  async function readOffice(file) {
    const ext = (file.name.match(/\.(\w+)$/) || [0, ''])[1].toLowerCase();
    const z = await unzip(await readFile(file, 'buffer'));
    if (ext === 'docx') return [{ p: 0, text: docxText(xml(await z.text('word/document.xml'))) }];
    if (ext === 'pptx') {
      const slides = z.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
      const pages = [];
      for (const s of slides) {
        const d = xml(await z.text(s));
        pages.push({ p: num(s), text: byTag(d, 'a:p').map((p) => textIn(p, 'a:t')).filter((t) => t.trim()).join('\n') });
      }
      return pages;
    }
    if (ext === 'xlsx') {
      const ssXml = await z.text('xl/sharedStrings.xml');
      const shared = ssXml ? byTag(xml(ssXml), 'si').map((si) => textIn(si, 't')) : [];
      const wb = await z.text('xl/workbook.xml');
      const sheetNames = wb ? byTag(xml(wb), 'sheet').map((s) => s.getAttribute('name')) : [];
      const sheets = z.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
      const pages = [];
      for (const s of sheets) {
        // Chaque cellule est écrite avec sa référence et, s'il y en a une, sa formule :
        // « C3: 800 [=B2*B3] ». Manaen peut ainsi retrouver la méthode de calcul (Kv, chiffrage…).
        const rows = byTag(xml(await z.text(s)), 'row').slice(0, 5000).map((r) => byTag(r, 'c').map((c) => {
          const t = c.getAttribute('t');
          let v = t === 's' ? shared[parseInt(textIn(c, 'v'), 10)] || '' : t === 'inlineStr' ? textIn(c, 't') : textIn(c, 'v');
          const f = c.getElementsByTagName('f')[0];
          if (f) v += f.textContent ? ' [=' + f.textContent + ']' : ' [formule recopiée]';
          return v === '' ? '' : (c.getAttribute('r') || '') + ': ' + v;
        }).filter(Boolean).join(' | '));
        const name = sheetNames[num(s) - 1];
        const body = rows.filter(Boolean).join('\n');
        if (body) pages.push({ p: num(s), text: (name ? 'Feuille « ' + name + ' » (cellule: valeur [=formule])\n' : '') + body });
      }
      return pages;
    }
    if (ext === 'odt' || ext === 'odp' || ext === 'ods') {
      const d = xml(await z.text('content.xml'));
      if (ext === 'ods') {
        return [{ p: 0, text: byTag(d, 'table:table-row').map((r) => byTag(r, 'table:table-cell').map((c) => c.textContent).join(' | ')).filter((r) => r.replace(/[ |]/g, '')).join('\n') }];
      }
      const parts = Array.from(d.getElementsByTagName('*')).filter((n) => n.tagName === 'text:p' || n.tagName === 'text:h');
      return [{ p: 0, text: parts.map((n) => (n.tagName === 'text:h' ? '## ' : '') + n.textContent).join('\n') }];
    }
    throw new Error('Format non reconnu.');
  }

  async function summarize(name, pages) {
    const sample = pages.map((p) => p.text).join('\n').slice(0, 9000);
    if (sample.trim().length < 40) return '';
    try {
      const res = await api.call({
        model: CFG.fastModel, max_tokens: 300,
        messages: [{ role: 'user', content: 'Voici le début du document « ' + name + ' ». En 2 phrases maximum et en français, dis de quoi il s\'agit (type de document, matériel ou sujet, marque/modèle, références). Pas d\'introduction.\n\n' + sample }]
      });
      return api.textOf(res).trim();
    } catch (e) {
      return '';
    }
  }

  // Lit un fichier et l'ajoute aux documents. onProgress(texte, fraction)
  async function importDocument(file, onProgress, confirmScan) {
    const lower = file.name.toLowerCase();
    let pages, type, method = 'texte';
    if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
      type = 'PDF';
      ({ pages, method } = await readPdf(file, onProgress, confirmScan));
    } else if (file.type.startsWith('image/')) {
      type = 'Photo';
      method = 'photo';
      onProgress('Manaen lit l\'image…', 0.3);
      pages = [{ p: 0, text: await readImages([await resizeImage(await readFile(file, 'dataurl'), 1600, 0.85)], 1, false) }];
    } else if (/\.(docx|pptx|xlsx|odt|odp|ods)$/.test(lower)) {
      type = { docx: 'Word', odt: 'Word', pptx: 'PowerPoint', odp: 'PowerPoint', xlsx: 'Excel', ods: 'Excel' }[lower.split('.').pop()];
      onProgress('Lecture du fichier ' + type + '…', 0.3);
      pages = await readOffice(file);
      if (type === 'PowerPoint') method = 'diapos';
    } else if (/\.(doc|ppt|xls)$/.test(lower)) {
      throw new Error('Ancien format Office : ouvre-le et enregistre-le en .docx / .pptx / .xlsx (ou en PDF), puis ajoute-le.');
    } else {
      type = 'Texte';
      pages = [{ p: 0, text: await readFile(file, 'text') }];
    }
    const chars = pages.reduce((s, x) => s + (x.text || '').length, 0);
    if (chars < 20) throw new Error('Aucun texte trouvé dans ce fichier.');
    onProgress('Manaen résume le document…', 0.9);
    const meta = {
      id: uid(), name: file.name.replace(/\.[^.]+$/, ''), type,
      pages: type === 'PDF' || type === 'PowerPoint' ? pages.length : 0, chars, method,
      summary: await summarize(file.name, pages), ts: Date.now()
    };
    await M.store.Docs.add(meta, pages);
    return meta;
  }

  M.ingest = { importDocument, prepareAttachment, splitPages };
})();
