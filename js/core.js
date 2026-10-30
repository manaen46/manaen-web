/*
 * Manaen — socle commun : réglages fixes, petits outils, accès au téléphone.
 *
 * Organisation du code (chargé dans cet ordre par index.html) :
 *   markdown.js  affichage du Markdown des réponses
 *   files.js     fabrication des fichiers Excel / Word / PDF
 *   core.js      ce fichier
 *   store.js     stockage : réglages, mémoire, documents, discussions, sauvegarde
 *   api.js       appels au cerveau (API Claude)
 *   brain.js     consignes, outils et déroulé d'une réponse
 *   ingest.js    lecture des documents (PDF, scans, photos, texte)
 *   voice.js     dictée et lecture à voix haute
 *   ui.js        interface
 *   main.js      démarrage
 */
(function () {
  'use strict';
  const M = (window.M = window.M || {});

  // ---------------- Réglages fixes ----------------
  M.config = {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    apiVersion: '2023-06-01',
    fastModel: 'claude-haiku-5-5',
    models: [
      { id: 'claude-sonnet-5-5', name: 'Équilibré', desc: 'Le meilleur rapport qualité/prix. Recommandé.' },
      { id: 'claude-haiku-5-5', name: 'Rapide', desc: 'Très rapide et le moins cher, pour les questions simples.' },
      { id: 'claude-opus-5-5', name: 'Expert', desc: 'Le plus fort pour les cas difficiles, plus cher.' }
    ],
    maxTokens: 32000,
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/',
    categories: ['Moi', 'Chantiers', 'Technique', 'Enseignement', 'Divers'],
    maxConversations: 200,
    seedMemory: [
      ['Je m\'appelle Franck.', 'Moi'],
      ['J\'ai 24 ans d\'expérience en génie climatique / CVC (chauffage, ventilation, climatisation).', 'Moi'],
      ['Je fais des chantiers et des mises en service, notamment de systèmes VRV Daikin.', 'Chantiers'],
      ['Je prépare le CAPLP pour enseigner le génie climatique (option équipements techniques-énergie).', 'Enseignement'],
      ['Je prépare des cours pour le bac pro MEE et des formations bac pro / CAP en climatisation et chauffage.', 'Enseignement'],
      ['J\'habite à Bapaume, dans les Hauts-de-France.', 'Moi']
    ],
    suggestions: [
      ['Dépannage', 'Un VRV Daikin affiche le code U4 : causes possibles et méthode de diagnostic ?'],
      ['Calcul', 'Comment calculer la charge complémentaire de R32 pour 25 m de liaison en 3/8 – 5/8 ?'],
      ['Cours', 'Prépare une séance de 2 h pour des 1re bac pro sur le cycle frigorifique, avec une activité élèves.'],
      ['Réglementation', 'Quelles sont les obligations de contrôle d\'étanchéité selon la charge en tonnes équivalent CO₂ ?']
    ]
  };

  // ---------------- Petits outils ----------------
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
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
    if (d.toDateString() === now.toDateString()) {
      return 'aujourd\'hui ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  }

  // Texte sans accents ni majuscules, pour comparer et chercher
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function readFile(file, as) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      if (as === 'buffer') r.readAsArrayBuffer(file);
      else if (as === 'dataurl') r.readAsDataURL(file);
      else r.readAsText(file);
    });
  }

  function bytesToB64(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  M.util = {
    $, $$, el, toast, fmtDate, norm, readFile, bytesToB64,
    esc: (s) => window.MD.esc(String(s == null ? '' : s)),
    uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    fmtNum: (n) => Math.round(n).toLocaleString('fr-FR')
  };

  // ---------------- Plateforme : appli Android ou navigateur ----------------
  // Dans l'appli, le code Java expose window.ManaenNative et rappelle les fonctions window.__on*.
  const N = () => window.ManaenNative;
  M.platform = {
    isNative: () => !!N(),
    isDesktop: () => !N() && !!window.matchMedia && window.matchMedia('(pointer: fine)').matches,
    version() {
      try { return N() ? N().version() : 'version ordinateur'; } catch (e) { return '?'; }
    },
    openUrl(url) {
      if (N()) N().openUrl(url);
      else window.open(url, '_blank');
    },
    // Enregistre un fichier : sélecteur « Enregistrer sous » sur Android, téléchargement sur PC
    saveFile(name, mime, bytes, label) {
      if (typeof bytes === 'string') bytes = new TextEncoder().encode(bytes);
      if (N()) {
        window.__onSaved = (ok) => toast(ok ? (label || 'Fichier') + ' enregistré ✔' : 'Enregistrement annulé');
        N().saveBase64(name, mime, bytesToB64(bytes));
      } else {
        const a = el('a', { href: URL.createObjectURL(new Blob([bytes], { type: mime })), download: name });
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    }
  };
})();
