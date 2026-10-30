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
    } else if (/\.(docx?|xlsx?|pptx?|odt)$/.test(lower)) {
      throw new Error('Format Office non lu directement : enregistre-le en PDF puis ajoute le PDF.');
    } else {
      type = 'Texte';
      pages = [{ p: 0, text: await readFile(file, 'text') }];
    }
    const chars = pages.reduce((s, x) => s + (x.text || '').length, 0);
    if (chars < 20) throw new Error('Aucun texte trouvé dans ce fichier.');
    onProgress('Manaen résume le document…', 0.9);
    const meta = {
      id: uid(), name: file.name.replace(/\.[^.]+$/, ''), type,
      pages: type === 'PDF' ? pages.length : 0, chars, method,
      summary: await summarize(file.name, pages), ts: Date.now()
    };
    await M.store.Docs.add(meta, pages);
    return meta;
  }

  M.ingest = { importDocument, prepareAttachment, splitPages };
})();
