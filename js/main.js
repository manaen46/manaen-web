/* Manaen — démarrage. */
(function () {
  'use strict';
  const M = window.M;
  const { Settings, Memory, Docs, Chats } = M.store;

  async function start() {
    Settings.load();
    if (!M.platform.isNative() && 'serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    try {
      await Memory.load();
      await Docs.load();
      await Chats.load();
    } catch (e) {
      M.util.toast('Erreur de stockage : ' + e.message, 5000);
      if (!Chats.current) Chats.current = Chats.blank();
    }
    M.ui.init();
  }

  // Accès pour les tests automatiques
  window.__manaen = {
    Memory, Docs, Chats, Settings,
    tokens: M.store.tokens, chunkPages: M.store.chunkPages, splitPagesFromTranscript: M.ingest.splitPages,
    windowMessages: M.brain.windowMessages, sanitize: M.brain.sanitize
  };

  start();
})();
