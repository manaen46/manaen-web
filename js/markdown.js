// Petit moteur Markdown pour les réponses de Manaen (titres, gras, listes, tableaux, code, liens,
// images et schémas).
(function () {
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function unesc(s) {
    return s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  }

  // Seules les images de Wikimedia Commons (libres de droits) et les schémas dessinés par Manaen sont affichés
  function imageAllowed(url) {
    return /^https:\/\/(upload|thumb)\.wikimedia\.org\/[^\s"'<>]+$/.test(url) || /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(url);
  }
  function svgDataUrl(svg) {
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  }

  let credits = {};
  // alt et url sont déjà échappés
  function figure(alt, url) {
    const raw = unesc(url);
    if (!imageAllowed(raw)) return '<a href="' + url + '" data-ext="1">🖼 ' + (alt || 'image') + '</a>';
    const credit = credits[raw] ? '<span class="credit">' + esc(credits[raw]) + '</span>' : '';
    return '<figure class="fig"><img src="' + url + '" alt="' + alt + '" loading="lazy">' +
      (alt || credit ? '<figcaption>' + alt + credit + '</figcaption>' : '') + '</figure>';
  }

  function inline(s) {
    // s est déjà échappé
    const codes = [];
    s = s.replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = s.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, function (_, alt, url) { return figure(alt, url); });
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" data-ext="1">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return '<code>' + codes[+i] + '</code>'; });
    return s;
  }

  function isTableSep(line) {
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  }
  function cells(line) {
    let l = line.trim();
    if (l.startsWith('|')) l = l.slice(1);
    if (l.endsWith('|')) l = l.slice(0, -1);
    return l.split('|').map(function (c) { return c.trim(); });
  }

  // opts.credits : { url de l'image : « Photo : auteur — licence » }
  function render(src, opts) {
    credits = (opts && opts.credits) || {};
    const lines = esc(String(src || '')).replace(/\r/g, '').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      let line = lines[i];

      // Bloc de code
      const fence = line.match(/^\s*```\s*(\w*)/);
      if (fence) {
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        if (fence[1].toLowerCase() === 'svg') {
          // Schéma dessiné par Manaen : affiché comme une image (aucun script ne peut s'exécuter)
          out.push('<figure class="fig schema"><img src="' + svgDataUrl(unesc(buf.join('\n'))) + '" alt="Schéma"></figure>');
        } else {
          out.push('<pre><code>' + buf.join('\n') + '</code></pre>');
        }
        continue;
      }

      // Image seule sur sa ligne
      const img = line.match(/^\s*!\[([^\]]*)\]\(([^\s)]+)\)\s*$/);
      if (img) { out.push(figure(img[1], img[2])); i++; continue; }

      if (/^\s*$/.test(line)) { i++; continue; }

      // Titres
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const lvl = Math.min(h[1].length + 1, 5);
        out.push('<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>');
        i++;
        continue;
      }

      // Ligne horizontale
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

      // Tableau
      if (line.indexOf('|') !== -1 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].indexOf('|') !== -1 && !/^\s*$/.test(lines[i])) {
          rows.push(cells(lines[i]));
          i++;
        }
        let t = '<div class="tbl"><table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
        rows.forEach(function (r) {
          t += '<tr>' + head.map(function (_, k) { return '<td>' + inline(r[k] || '') + '</td>'; }).join('') + '</tr>';
        });
        t += '</tbody></table></div>';
        out.push(t);
        continue;
      }

      // Citation
      if (/^\s*&gt;\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*&gt;\s?/, '')); i++; }
        out.push('<blockquote>' + render_inline_block(buf) + '</blockquote>');
        continue;
      }

      // Listes
      const li = line.match(/^(\s*)([-*+•]|\d+[.)])\s+(.*)$/);
      if (li) {
        const ordered = /\d/.test(li[2]);
        const tag = ordered ? 'ol' : 'ul';
        let html = '<' + tag + '>';
        while (i < lines.length) {
          const m = lines[i].match(/^(\s*)([-*+•]|\d+[.)])\s+(.*)$/);
          if (!m) {
            // continuation indentée
            if (/^\s{2,}\S/.test(lines[i]) && html.endsWith('</li>')) {
              html = html.slice(0, -5) + '<br>' + inline(lines[i].trim()) + '</li>';
              i++;
              continue;
            }
            break;
          }
          const sub = m[1].length >= 2;
          const content = inline(m[3]);
          html += '<li' + (sub ? ' class="sub"' : '') + '>' + content + '</li>';
          i++;
        }
        html += '</' + tag + '>';
        out.push(html);
        continue;
      }

      // Paragraphe
      const buf = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) &&
        !/^\s*```/.test(lines[i]) && !/^(\s*)([-*+•]|\d+[.)])\s+/.test(lines[i]) && !/^\s*&gt;/.test(lines[i]) &&
        !(lines[i].indexOf('|') !== -1 && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
        buf.push(lines[i]);
        i++;
      }
      if (buf.length) out.push('<p>' + buf.map(inline).join('<br>') + '</p>');
      else i++;
    }
    return out.join('');
  }

  function render_inline_block(lines) {
    return lines.map(inline).join('<br>');
  }

  window.MD = { render: render, esc: esc, imageAllowed: imageAllowed, svgDataUrl: svgDataUrl };
})();
