/* Manaen — le cerveau : consignes, outils, et déroulé complet d'une réponse. */
(function () {
  'use strict';
  const M = window.M;
  const CFG = M.config;
  const { Settings, Memory, Docs } = M.store;
  const api = M.api;

  // ================= Consignes permanentes =================
  const PERSONA = `Tu es **Manaen**, l'assistant professionnel personnel de Franck. Tu tournes dans une appli que Franck a fait créer rien que pour lui (téléphone et ordinateur). Tu le tutoies, tu parles français, avec le ton d'un collègue expérimenté, direct et bienveillant.

# Tes domaines d'expertise
- **Génie climatique / CVC** : climatisation, pompes à chaleur air/air et air/eau, VRV/DRV (Daikin, Mitsubishi, Toshiba, Atlantic…), groupes froid, CTA, ventilation (VMC simple et double flux), chauffage (chaudières gaz/fioul/bois, planchers chauffants, radiateurs, émetteurs), régulation, équilibrage, hydraulique, ECS, énergies renouvelables (solaire thermique, PAC, géothermie).
- **Froid** : cycle frigorifique, diagrammes enthalpiques, surchauffe/sous-refroidissement, fluides (R32, R410A, R454B, R290, R744…), brasage, tirage au vide, charge, recherche de fuites, mise en service, dépannage, lecture de codes défaut.
- **Plomberie et bâtiment** : sanitaire, évacuations, gaz, dimensionnement de réseaux, second œuvre, menuiserie, toiture, isolation, DTU (60.1, 60.11, 61.1, 65.x, 68.3, 36.5…), RE2020, thermique du bâtiment, bilans de déperditions.
- **Réglementation et sécurité** : règlement F-gaz (UE 2024/573) et attestations d'aptitude et de capacité, contrôles d'étanchéité, NF EN 378, fluides A2L/A3, habilitation électrique, consignation, EPI, prévention des risques sur chantier. La réglementation évolue : quand un texte officiel est dans ses documents, il fait foi sur ce que tu crois savoir.
- **Enseignement** : préparation de cours, séances, TP, évaluations et corrigés pour les bacs pro (MEE, ICCER, MFER…) et CAP du génie climatique, avec repères sur les référentiels (compétences, savoirs associés) ; préparation du concours CAPLP (oraux, dossiers, didactique).

# Ta manière de répondre
- Va droit au but : la réponse utile d'abord, les détails ensuite. Franck lit souvent sur son téléphone, sur chantier : paragraphes courts, listes, petits tableaux quand ça aide.
- Pour un **calcul**, pose la formule, les valeurs avec leurs unités, le résultat, et un ordre de grandeur pour vérifier.
- Pour un **dépannage**, raisonne comme un technicien : causes les plus probables d'abord, vérifications concrètes dans l'ordre, valeurs normales attendues, et quand appeler le constructeur.
- Pour un **cours**, structure : objectifs, prérequis, déroulé minuté, activités élèves, évaluation, en restant au niveau des élèves. Pour un gros travail (progression complète, plusieurs séances), fais-le par étapes : une séance par réponse, et propose la suivante.
- Sois honnête sur tes limites : si une valeur, un code défaut ou un article de norme dépend du modèle ou de la version, dis-le et invite à vérifier la notice constructeur ou le texte officiel. N'invente jamais une référence de norme, un code erreur ou un chiffre précis dont tu n'es pas sûr.
- Rappelle la sécurité quand c'est vraiment utile (fluide inflammable, électricité, gaz, travail en hauteur), sans faire la morale.
- Utilise ce que tu sais de Franck (mémoire ci-dessous) pour adapter tes réponses, sans le lui réciter.
- Sois économe : pas de longs préambules ni de répétitions ; développe seulement quand c'est demandé ou vraiment utile.

# Ta mémoire : tu apprends au fil des discussions
Tu as une mémoire permanente (liste plus bas). Chaque info a un identifiant [mN].
- Quand Franck te dit de retenir quelque chose, appelle l'outil \`memoriser\`.
- {{AUTO}}
- S'il te corrige ou qu'une info a changé, appelle \`corriger_memoire\` sur la bonne ligne (texte vide = supprimer).
- Écris chaque info comme une phrase courte et autonome, à la 1re personne de Franck (« Je… », « Sur mes chantiers… »).
- Ne mémorise jamais de mot de passe, code d'accès, clé, numéro bancaire ou info de santé.
- Après avoir mémorisé, mentionne-le en une demi-phrase seulement.

# Ses documents
Franck peut te confier des documents (notices, référentiels, DTU, cours, textes officiels). Des extraits pertinents sont parfois joints automatiquement à sa question. Si ça ne suffit pas, utilise l'outil \`rechercher_documents\` avec des mots-clés précis (plusieurs fois si besoin, avec d'autres mots). Quand tu t'appuies sur un document, cite-le brièvement : (Notice XYZ, p. 12).

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
- Si la mémoire ou ses consignes ne disent pas sur quelle base Franck calcule chaque frais, demande-le une fois (ou suis l'énoncé), puis mémorise sa méthode (catégorie Technique) et applique-la toujours.
- Présente toujours : la formule littérale, le calcul étape par étape dans un tableau (DS → FC → FOP → FG → CR → B&A → PV HT → Kv), les résultats arrondis (Kv à 3 décimales, montants à 2 décimales), puis une vérification (DS × Kv = PV HT).
- Pour un devis, un DQE ou une DPGF : colonnes Désignation, Unité, Quantité, PU DS, Total DS, puis Kv, PU vente HT, Total vente HT, et totaux HT, TVA, TTC.

# Fichiers Excel
Quand un tableau de calcul serait utile en fichier (chiffrage, Kv, quantitatif, métré, DQE, DPGF, bilan, planning, grille d'évaluation, notes…), ou si Franck le demande, appelle l'outil \`creer_tableur\`. Mets de **vraies formules Excel** pour que le fichier se recalcule s'il change une valeur : syntaxe anglaise (SUM, ROUND, IF, PRODUCT), séparateur virgule, point décimal, références A1 (ex. "=C2*D2", "=SUM(E2:E9)", "=ROUND(B12/B2,3)"). Ligne 1 = en-têtes. Formats possibles par cellule : {"v": …, "format": "euro" | "pourcent" | "nombre", "gras": true}. Un pourcentage s'écrit en décimal (0.12 avec format pourcent). Vérifie que chaque référence pointe sur la bonne cellule. Reste raisonnable en taille (quelques centaines de lignes au plus ; sinon plusieurs fichiers). Montre aussi le résultat dans ta réponse.
Sous chacune de tes réponses, Franck a des boutons pour l'exporter en Word ou en PDF, et en Excel s'il y a des tableaux : pour un cours, une fiche ou un rapport, rédige proprement en Markdown (titres, listes, tableaux) pour que l'export soit propre.{{WEB}}{{CONSIGNES}}`;

  const TXT = {
    autoOn: 'Sans qu\'il le demande, mémorise aussi les infos **durables et utiles** qu\'il donne : ses habitudes de travail, ses préférences de réponse, ses chantiers et clients en cours, le matériel qu\'il utilise, ses classes et cours, ses méthodes et valeurs de réglage. Ne mémorise pas les détails ponctuels d\'une seule question, ni ce que tu as toi-même expliqué.',
    autoOff: 'La mémoire automatique est désactivée : ne mémorise que si Franck le demande explicitement.',
    web: '\n\n# Recherche sur Internet\nTu peux chercher sur le web (outil web_search) pour les prix, la réglementation récente, les fiches et notices constructeurs. Ne le fais que si c\'est utile, et donne les sources.',
    consignes: '\n\n# Consignes personnelles de Franck (prioritaires sur tout ce qui précède, sauf la sécurité et l\'honnêteté)\n',
    voice: ' Cette question a été dictée (la reconnaissance vocale peut avoir mal compris un mot technique : corrige mentalement) et ta réponse sera lue à voix haute. Réponds de façon courte et orale : phrases simples, pas de tableau ni de longue liste, les chiffres clés d\'abord. Propose d\'envoyer le détail par écrit si c\'est long.'
  };

  // Consignes + contexte (mémoire figée, date du jour). Tout est mis en cache.
  function buildSystem(context) {
    const s = Settings.data;
    const consignes = (s.consignes || '').trim();
    const persona = PERSONA
      .replace('{{AUTO}}', s.autoMemory ? TXT.autoOn : TXT.autoOff)
      .replace('{{WEB}}', s.webSearch ? TXT.web : '')
      .replace('{{CONSIGNES}}', consignes ? TXT.consignes + consignes : '');
    return [
      { type: 'text', text: persona, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: context, cache_control: { type: 'ephemeral' } }
    ];
  }

  // ================= Outils =================
  const TOOLS = [
    {
      name: 'memoriser',
      description: 'Enregistre dans la mémoire permanente de Manaen une information durable sur Franck, son travail, ses préférences, ou une connaissance technique qu\'il t\'apprend.',
      input_schema: {
        type: 'object',
        properties: {
          fait: { type: 'string', description: 'L\'information, en une phrase courte et autonome, à la 1re personne de Franck.' },
          categorie: { type: 'string', enum: CFG.categories, description: 'Moi = qui il est et ses préférences ; Chantiers = chantiers, clients, matériel ; Technique = méthodes, réglages, astuces ; Enseignement = cours, classes, concours ; Divers = le reste.' }
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
      description: 'Recherche par mots-clés dans les documents de Franck (notices, référentiels, DTU, cours…). Renvoie les extraits les plus pertinents avec le nom du document et la page.',
      input_schema: {
        type: 'object',
        properties: { requete: { type: 'string', description: 'Mots-clés précis (termes techniques, références, codes).' } },
        required: ['requete']
      }
    },
    {
      name: 'creer_tableur',
      description: 'Crée un fichier Excel (.xlsx) avec de vraies formules, que Franck peut ouvrir et enregistrer. Pour chiffrages, Kv, quantitatifs, DQE/DPGF, métrés, bilans, grilles d\'évaluation, notes d\'élèves…',
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

  function buildTools() {
    const tools = TOOLS.slice();
    if (Settings.data.webSearch) {
      tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 4, user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' } });
    }
    return tools;
  }

  const TOOL_STATUS = {
    memoriser: () => 'Je retiens ça…',
    corriger_memoire: () => 'Je mets à jour ma mémoire…',
    rechercher_documents: (i) => 'Je cherche dans tes documents : ' + (i.requete || ''),
    creer_tableur: () => 'Je prépare le fichier Excel…'
  };

  // Exécute un outil demandé par le cerveau ; `turn` collecte ce qu'il faut afficher ensuite.
  async function runTool(name, input, turn) {
    try {
      switch (name) {
        case 'memoriser': {
          const it = await Memory.add(input.fait, input.categorie, 'auto');
          if (!it) return 'Rien à mémoriser (texte vide).';
          turn.mem.push('Retenu : ' + it.text);
          return 'Mémorisé sous [' + it.id + '].';
        }
        case 'corriger_memoire': {
          const id = String(input.id || '').replace(/[[\]]/g, '');
          const txt = String(input.nouveau_texte || '').trim();
          if (!txt) {
            const old = Memory.find(id);
            if (!(await Memory.remove(id))) return 'Identifiant introuvable.';
            turn.mem.push('Oublié : ' + (old ? old.text : id));
            return 'Supprimé.';
          }
          const it = await Memory.update(id, txt);
          if (!it) return 'Identifiant introuvable.';
          turn.mem.push('Corrigé : ' + it.text);
          return 'Corrigé.';
        }
        case 'rechercher_documents': {
          if (!Docs.list.length) return 'Franck n\'a encore ajouté aucun document.';
          const r = Docs.search(input.requete, 6);
          return r.length ? Docs.excerpts(r, 14000) : 'Aucun extrait trouvé pour « ' + input.requete + ' ». Essaie d\'autres mots-clés.';
        }
        case 'creer_tableur': {
          const feuilles = Array.isArray(input.feuilles) ? input.feuilles : [];
          if (!feuilles.length) return 'Erreur : aucune feuille fournie.';
          const nom = String(input.nom_fichier || 'Tableau Manaen').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Tableau Manaen';
          window.Files.xlsx(feuilles); // vérifie que le fichier se fabrique bien
          turn.files.push({ kind: 'xlsx', name: nom + '.xlsx', spec: feuilles });
          const n = feuilles.reduce((s, f) => s + (f.lignes || []).length, 0);
          return 'Fichier « ' + nom + '.xlsx » créé (' + feuilles.length + ' feuille(s), ' + n + ' lignes). Franck a un bouton sous ta réponse pour l\'enregistrer.';
        }
        default:
          return 'Outil inconnu.';
      }
    } catch (e) {
      return 'Erreur de l\'outil : ' + e.message;
    }
  }

  // ================= Historique envoyé au cerveau =================
  const isThinking = (b) => b.type === 'thinking' || b.type === 'redacted_thinking';
  const isPlainUser = (m) => m.role === 'user' && (typeof m.content === 'string' || !m.content.some((b) => b.type === 'tool_result'));
  const asBlocks = (m) => (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content);

  // Répare un historique abîmé (réponse coupée au milieu d'un outil…) pour qu'il reste valide.
  function sanitize(msgs) {
    const out = [];
    msgs.forEach((m, i) => {
      if (m.role === 'assistant' && Array.isArray(m.content)) {
        const next = msgs[i + 1];
        const answered = new Set();
        if (next && next.role === 'user' && Array.isArray(next.content)) next.content.forEach((b) => { if (b.type === 'tool_result') answered.add(b.tool_use_id); });
        const webDone = new Set(m.content.filter((b) => b.type === 'web_search_tool_result').map((b) => b.tool_use_id));
        let c = m.content.filter((b) => (b.type === 'tool_use' ? answered.has(b.id) : b.type === 'server_tool_use' ? webDone.has(b.id) : true));
        if (!c.some((b) => !isThinking(b))) c = [{ type: 'text', text: '…' }];
        if (c.length !== m.content.length) m = { role: 'assistant', content: c };
      } else if (m.role === 'user' && Array.isArray(m.content)) {
        const prev = out[out.length - 1];
        const asked = new Set();
        if (prev && prev.role === 'assistant') asBlocks(prev).forEach((b) => { if (b.type === 'tool_use') asked.add(b.id); });
        const c = m.content.filter((b) => b.type !== 'tool_result' || asked.has(b.tool_use_id));
        if (c.length !== m.content.length) m = { role: 'user', content: c.length ? c : [{ type: 'text', text: '(suite)' }] };
      }
      const prev = out[out.length - 1];
      if (prev && prev.role === m.role) out[out.length - 1] = { role: m.role, content: asBlocks(prev).concat(asBlocks(m)) }; // jamais deux fois le même rôle
      else out.push(m);
    });
    return out;
  }

  // ================= Économies : cache et historique compact =================
  // Le cerveau facture chaque mot qu'on lui envoie. Pour que ce soit peu cher :
  //  1. le début de chaque demande (consignes, mémoire, historique) doit rester IDENTIQUE
  //     d'une question à l'autre : il est alors relu depuis le cache, ~20 fois moins cher ;
  //  2. une fois une réponse terminée, on allège ce qui ne sert plus (résultats web,
  //     extraits de documents, gros tableurs, réflexions, photos).

  const WINDOW_MAX_MSGS = 60;      // au-delà, on repart d'une fenêtre plus courte…
  const WINDOW_MAX_CHARS = 240000;
  const WINDOW_KEEP_MSGS = 16;     // …qui garde la fin de la discussion

  const EXCERPT_TAG = '[[EXTRAITS]]';
  const VOICE_TAG = '[[VOIX]]';

  function snapshot() {
    return '# Mémoire permanente (ce que tu sais de Franck)\n' + Memory.forPrompt() + '\n\n# Documents disponibles\n' + Docs.forPrompt();
  }

  // Fenêtre d'historique stable : elle ne bouge que rarement, et d'un coup.
  function updateWindow(conv) {
    if (conv.winStart == null) conv.winStart = 0;
    const tail = conv.api.slice(conv.winStart);
    if (tail.length <= WINDOW_MAX_MSGS && JSON.stringify(tail).length <= WINDOW_MAX_CHARS) return false;
    let start = Math.max(conv.winStart, conv.api.length - WINDOW_KEEP_MSGS);
    while (start < conv.api.length - 1 && !isPlainUser(conv.api[start])) start++;
    conv.winStart = start;
    return true;
  }

  // Ce que le cerveau reçoit avant la discussion. La mémoire est figée au début de chaque
  // discussion (ou quand la fenêtre se décale) : sinon chaque info retenue casserait le cache.
  function buildContext(conv, shifted) {
    if (!conv.memSnap || shifted || !conv.api.length) conv.memSnap = snapshot();
    const day = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const system = buildSystem(conv.memSnap + '\n\n# Date\n' + day + '.');
    const tools = buildTools();
    const thinking = Settings.data.deepThinking ? undefined : { type: 'disabled' };
    return { system, tools, thinking };
  }

  // Retire les réflexions d'un message (elles ne servent plus une fois la réponse donnée)
  function dropThinking(m) {
    if (m.role !== 'assistant' || !Array.isArray(m.content) || !m.content.some(isThinking)) return m;
    const c = m.content.filter((b) => !isThinking(b));
    return { role: 'assistant', content: c.length ? c : [{ type: 'text', text: '…' }] };
  }

  // Allège un tour terminé (à partir de la question qIndex)
  function compactTurn(conv, qIndex) {
    for (let i = qIndex; i < conv.api.length; i++) {
      let m = conv.api[i];
      if (!Array.isArray(m.content)) continue;
      if (m.role === 'user') {
        m = {
          role: 'user',
          content: m.content.map((b) => {
            if (b.type === 'image') return { type: 'text', text: '[Photo jointe à ce message]' };
            if (b.type === 'document') return { type: 'text', text: '[PDF joint à ce message' + (b.title ? ' : ' + b.title : '') + ']' };
            if (b.type === 'text' && b.text.startsWith(EXCERPT_TAG)) return { type: 'text', text: '[Extraits de ses documents fournis pour cette question]' };
            if (b.type === 'text' && b.text.startsWith(VOICE_TAG)) return { type: 'text', text: '[Question dictée à la voix]' };
            if (b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > 1500) {
              return Object.assign({}, b, { content: b.content.slice(0, 600) + '\n[… extraits raccourcis : relance rechercher_documents si besoin]' });
            }
            return b;
          })
        };
      } else {
        m = dropThinking(m);
        const webIds = new Set(m.content.filter((b) => b.type === 'server_tool_use').map((b) => b.id));
        m = {
          role: 'assistant',
          content: m.content
            .filter((b) => !(b.type === 'server_tool_use' || b.type === 'web_search_tool_result'))
            .map((b) => {
              if (b.type === 'text' && b.citations) { const c = Object.assign({}, b); delete c.citations; return c; }
              if (b.type === 'tool_use' && b.name === 'creer_tableur') {
                return Object.assign({}, b, { input: { nom_fichier: (b.input && b.input.nom_fichier) || 'Tableau', feuilles: '[fichier créé et remis à Franck]' } });
              }
              return b;
            })
        };
        if (webIds.size) m.content.unshift({ type: 'text', text: '[J\'ai fait ' + webIds.size + ' recherche(s) sur Internet pour cette réponse.]' });
        if (!m.content.length) m.content = [{ type: 'text', text: '…' }];
      }
      conv.api[i] = m;
    }
  }

  // Historique envoyé : la fenêtre, réparée, sans réflexions des tours passés
  function history(conv) {
    return sanitize(conv.api.slice(conv.winStart || 0)).map(dropThinking);
  }

  // Ajoute un point de cache sur le dernier bloc du dernier message (sans modifier l'historique)
  function withCacheMark(messages) {
    if (!messages.length) return messages;
    const out = messages.slice();
    const last = out[out.length - 1];
    const blocks = asBlocks(last).slice();
    const i = blocks.length - 1;
    blocks[i] = Object.assign({}, blocks[i], { cache_control: { type: 'ephemeral' } });
    out[out.length - 1] = { role: last.role, content: blocks };
    return out;
  }

  // Pour les tests : ancienne interface (fenêtre + nettoyage)
  function windowMessages(all) {
    return sanitize(all).map(dropThinking);
  }

  // ================= Une réponse complète =================
  /**
   * Fait répondre le cerveau à une question, en enchaînant les outils si besoin.
   * conv      : la discussion (conv.api est complété)
   * content   : contenu de la question (texte, photos, PDF)
   * opts      : {voice, onStatus(texte), isCancelled()}
   * Renvoie   : {text, mem, sources, files, cancelled}. En cas d'erreur, l'historique est remis comme avant.
   */
  async function respond(conv, content, opts) {
    const status = opts.onStatus || (() => {});
    const cancelled = opts.isCancelled || (() => false);
    const question = content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
    const turn = { texts: [], mem: [], sources: [], files: [] };

    // Extraits de documents ajoutés d'office à la question si elle y ressemble (allégés ensuite)
    const extra = [];
    if (Docs.list.length && question.trim()) {
      const recent = conv.display.filter((m) => m.role === 'user').slice(-2).map((m) => m.text).join(' ');
      const r = Docs.search(recent || question, 4).filter((x) => x.score > 2);
      if (r.length) extra.push({ type: 'text', text: EXCERPT_TAG + ' Extraits de mes documents qui semblent liés :\n' + Docs.excerpts(r, 8000) });
    }
    if (opts.voice) extra.push({ type: 'text', text: VOICE_TAG + TXT.voice });

    if (!conv.compacted) { compactTurn(conv, 0); conv.compacted = true; } // anciennes discussions : on les allège une fois
    const shifted = updateWindow(conv);
    const qIndex = conv.api.length;
    conv.api.push({ role: 'user', content: extra.concat(content) });
    try {
      const ctx = buildContext(conv, shifted);
      // L'historique d'avant est figé pour tout le tour
      const prefix = history(conv).slice(0, -1);
      const qMsg = conv.api[qIndex];
      let restarted = false, cutRetry = false, noThinkingParam = !!Settings.data.noThinkingParam;

      for (let step = 0; step < 10 && !cancelled(); step++) {
        // Point de cache : sur le dernier message en temps normal ; sur la question si la réflexion est
        // active, pour que ce qui précède ses blocs de réflexion ne change pas pendant le tour.
        const msgs = Settings.data.deepThinking
          ? withCacheMark(prefix.concat([qMsg])).concat(conv.api.slice(qIndex + 1))
          : withCacheMark(prefix.concat([qMsg], conv.api.slice(qIndex + 1)));
        const body = { model: Settings.data.model, max_tokens: CFG.maxTokens, system: ctx.system, tools: ctx.tools, messages: msgs };
        if (ctx.thinking && !noThinkingParam) body.thinking = ctx.thinking;
        let res;
        try {
          res = await api.call(body);
        } catch (err) {
          // Si ce modèle refuse le réglage « sans réflexion », on s'en passe (et on s'en souvient)
          if (err.status === 400 && body.thinking && /thinking/i.test(err.message) && !/signature/i.test(err.message)) {
            noThinkingParam = true;
            Settings.set('noThinkingParam', true);
            step--;
            continue;
          }
          // Filet de sécurité : blocs de réflexion refusés → on reprend le tour une fois, sans eux
          if (!restarted && err.status === 400 && /thinking|signature/i.test(err.message)) {
            restarted = true;
            conv.api = conv.api.map(dropThinking);
            conv.api.splice(qIndex + 1);
            turn.texts = []; turn.sources = []; turn.files = [];
            status('Manaen reprend sa réflexion…');
            continue;
          }
          throw err;
        }
        if (cancelled()) break;
        conv.api.push({ role: 'assistant', content: res.content });
        res.content.forEach((b) => {
          if (b.type === 'text' && b.text) {
            turn.texts.push(b.text);
            (b.citations || []).forEach((c) => {
              if (c.url && !turn.sources.find((s) => s.url === c.url)) turn.sources.push({ url: c.url, title: c.title || c.url });
            });
          }
          if (b.type === 'server_tool_use' && b.name === 'web_search') status('Recherche sur Internet : ' + ((b.input && b.input.query) || '…'));
        });

        if (res.stop_reason === 'pause_turn') continue;
        if (res.stop_reason === 'tool_use') {
          const results = [];
          for (const b of res.content.filter((x) => x.type === 'tool_use')) {
            status((TOOL_STATUS[b.name] || (() => 'Je travaille…'))(b.input || {}));
            results.push({ type: 'tool_result', tool_use_id: b.id, content: await runTool(b.name, b.input || {}, turn) });
          }
          conv.api.push({ role: 'user', content: results });
          status('Manaen rédige…');
          continue;
        }
        if (res.stop_reason === 'max_tokens') {
          // Coupé au milieu d'un outil (souvent un gros tableur) : on lui demande de recommencer plus court.
          const cut = res.content.filter((b) => b.type === 'tool_use');
          if (cut.length && !cutRetry) {
            cutRetry = true;
            conv.api.push({
              role: 'user',
              content: cut.map((b) => ({
                type: 'tool_result', tool_use_id: b.id, is_error: true,
                content: 'Ta réponse a été coupée car trop longue : cet outil n\'a pas reçu ses données complètes. Recommence en plus court (moins de lignes, ou plusieurs fichiers/feuilles plus petits), sans répéter ce que tu as déjà écrit.'
              }))
            });
            status('Le fichier était trop long, Manaen recommence en plus court…');
            continue;
          }
          turn.texts.push('\n\n*(Réponse coupée car trop longue : demande-moi « continue ».)*');
        }
        break;
      }

      const wasCancelled = cancelled();
      const text = turn.texts.join('\n\n').trim();
      if (wasCancelled) {
        // On remplace le tour inachevé par une version courte et valide
        conv.api.splice(qIndex + 1);
        conv.api.push({ role: 'assistant', content: [{ type: 'text', text: text || '(réponse interrompue)' }] });
      } else if (conv.api[conv.api.length - 1].role === 'user') {
        // Limite d'étapes atteinte sur un outil : on referme proprement
        conv.api.push({ role: 'assistant', content: [{ type: 'text', text: text || '…' }] });
      }
      compactTurn(conv, qIndex);
      return {
        text: (text + (wasCancelled ? '\n\n*(interrompu)*' : '')).trim() || '(pas de réponse)',
        mem: turn.mem, sources: turn.sources.slice(0, 8), files: turn.files, cancelled: wasCancelled
      };
    } catch (e) {
      conv.api.splice(qIndex); // on retire le tour : la question pourra être renvoyée
      throw e;
    }
  }

  M.brain = { respond, buildSystem, buildTools, sanitize, windowMessages, compactTurn };
})();
