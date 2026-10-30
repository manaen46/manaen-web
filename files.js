// Fabrication de fichiers dans le téléphone : Excel (.xlsx avec formules), Word (.docx), PDF (impression).
(function () {
  'use strict';

  // ---------------- ZIP (sans compression) ----------------
  const CRC = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const enc = new TextEncoder();

  function zip(files) {
    // files : [{name, data:string|Uint8Array}]
    const parts = [];
    const central = [];
    let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true);
      h.setUint16(10, 0, true);
      h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true);
      h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true);
      h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, 0, true);
      c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true);
      c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const csize = central.reduce((s, x) => s + x.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true);
    e.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(e.buffer)]);
    const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
    let p = 0;
    all.forEach((x) => { out.set(x, p); p += x.length; });
    return out;
  }

  function x(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  // ---------------- EXCEL ----------------
  // Styles : 0 normal, 1 gras, 2 euro, 3 euro gras, 4 pourcent, 5 pourcent gras, 6 nombre 2 déc., 7 nombre gras, 8 en-tête (gras + fond)
  const FMT_IDX = { '': 0, euro: 2, pourcent: 4, nombre: 6 };

  function colName(i) {
    let s = '';
    i++;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  function normCell(c) {
    // renvoie {v, f, fmt, b}
    if (c == null) return { v: '' };
    if (typeof c === 'object' && !Array.isArray(c)) {
      const o = { v: c.v != null ? c.v : (c.valeur != null ? c.valeur : ''), fmt: c.format || c.fmt || '', b: !!(c.gras || c.b) };
      if (typeof o.v === 'string' && o.v.trim().startsWith('=')) { o.f = o.v.trim().slice(1); o.v = null; }
      return o;
    }
    if (typeof c === 'number') return { v: c };
    const s = String(c);
    if (s.trim().startsWith('=')) return { f: s.trim().slice(1), v: null };
    return { v: s };
  }

  function sheetXml(sheet) {
    const rows = sheet.lignes || sheet.rows || [];
    let maxCols = 0;
    rows.forEach((r) => { if (r.length > maxCols) maxCols = r.length; });
    const widths = sheet.largeurs || [];
    let cols = '';
    if (maxCols) {
      cols = '<cols>';
      for (let i = 0; i < maxCols; i++) {
        let w = widths[i];
        if (!w) {
          let m = 8;
          rows.forEach((r) => { const c = normCell(r[i]); const l = String(c.f ? 12 : (c.v == null ? '' : c.v)).length; if (l > m) m = l; });
          w = Math.min(60, m + 2);
        }
        cols += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      }
      cols += '</cols>';
    }
    const headerRow = sheet.entete === false ? -1 : 0;
    let data = '<sheetData>';
    rows.forEach((r, ri) => {
      data += '<row r="' + (ri + 1) + '">';
      r.forEach((raw, ci) => {
        const c = normCell(raw);
        const ref = colName(ci) + (ri + 1);
        let st = FMT_IDX[c.fmt] || 0;
        if (ri === headerRow && !c.f && typeof c.v === 'string') st = 8;
        else if (c.b) st = st === 0 ? 1 : st + 1;
        const sAttr = st ? ' s="' + st + '"' : '';
        if (c.f) {
          data += '<c r="' + ref + '"' + sAttr + '><f>' + x(c.f) + '</f></c>';
        } else if (typeof c.v === 'number' && isFinite(c.v)) {
          data += '<c r="' + ref + '"' + sAttr + '><v>' + c.v + '</v></c>';
        } else if (c.v !== '' && c.v != null) {
          data += '<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t xml:space="preserve">' + x(c.v) + '</t></is></c>';
        } else if (st) {
          data += '<c r="' + ref + '"' + sAttr + '/>';
        }
      });
      data += '</row>';
    });
    data += '</sheetData>';
    const freeze = headerRow === 0 && rows.length > 1
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + freeze + cols + data + '</worksheet>';
  }

  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="0.00%"/><numFmt numFmtId="166" formatCode="#,##0.000"/></numFmts>' +
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="9">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
    '<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
    '<xf numFmtId="165" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
    '<xf numFmtId="166" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '</cellXfs></styleSheet>';

  function xlsx(sheets) {
    sheets = sheets.length ? sheets : [{ nom: 'Feuille1', lignes: [] }];
    const used = {};
    const names = sheets.map((s, i) => {
      let n = String(s.nom || s.name || ('Feuille' + (i + 1))).replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 31).trim() || ('Feuille' + (i + 1));
      while (used[n.toLowerCase()]) n = n.slice(0, 28) + ' ' + (i + 1);
      used[n.toLowerCase()] = 1;
      return n;
    });
    const files = [
      {
        name: '[Content_Types].xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
          '</Types>'
      },
      {
        name: '_rels/.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
      },
      {
        name: 'xl/workbook.xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
          names.map((n, i) => '<sheet name="' + x(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') +
          '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
          '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
      },
      { name: 'xl/styles.xml', data: STYLES }
    ];
    sheets.forEach((s, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(s) }));
    return zip(files);
  }

  // Convertit un texte de cellule Markdown en nombre si possible
  function smartCell(s) {
    const raw = String(s).replace(/\*\*/g, '').replace(/`/g, '').trim();
    const t = raw.replace(/[\s  ]/g, '');
    let m = t.match(/^(-?\d+(?:[.,]\d+)?)%$/);
    if (m) return { v: parseFloat(m[1].replace(',', '.')) / 100, format: 'pourcent' };
    m = t.match(/^(-?\d+(?:[.,]\d+)?)(€|EUR|€HT|€TTC)$/i);
    if (m) return { v: parseFloat(m[1].replace(',', '.')), format: 'euro' };
    m = t.match(/^-?\d+(?:[.,]\d+)?$/);
    if (m) return parseFloat(t.replace(',', '.'));
    return raw;
  }

  // ---------------- Analyse Markdown (pour Word et Excel) ----------------
  function blocks(md) {
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    const out = [];
    let i = 0;
    const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
    const cells = (l) => { let s = l.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|')) s = s.slice(0, -1); return s.split('|').map((c) => c.trim()); };
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*```/.test(l)) {
        const buf = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push({ t: 'code', text: buf.join('\n') });
        continue;
      }
      if (/^\s*$/.test(l)) { i++; continue; }
      let m = l.match(/^(#{1,6})\s+(.*)$/);
      if (m) { out.push({ t: 'h', level: m[1].length, text: m[2] }); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { i++; continue; }
      if (l.indexOf('|') !== -1 && i + 1 < lines.length && isSep(lines[i + 1])) {
        const rows = [cells(l)];
        i += 2;
        while (i < lines.length && lines[i].indexOf('|') !== -1 && !/^\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        out.push({ t: 'table', rows: rows });
        continue;
      }
      m = l.match(/^(\s*)([-*+•]|\d+[.)])\s+(.*)$/);
      if (m) { out.push({ t: 'li', ordered: /\d/.test(m[2]), num: m[2], sub: m[1].length >= 2, text: m[3] }); i++; continue; }
      m = l.match(/^\s*>\s?(.*)$/);
      if (m) { out.push({ t: 'quote', text: m[1] }); i++; continue; }
      const buf = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) && !/^\s*```/.test(lines[i]) &&
        !/^(\s*)([-*+•]|\d+[.)])\s+/.test(lines[i]) && !/^\s*>/.test(lines[i]) &&
        !(lines[i].indexOf('|') !== -1 && i + 1 < lines.length && isSep(lines[i + 1]))) { buf.push(lines[i]); i++; }
      if (buf.length) out.push({ t: 'p', text: buf.join('\n') });
      else i++;
    }
    return out;
  }

  function tablesFromMarkdown(md) {
    return blocks(md).filter((b) => b.t === 'table').map((b) => b.rows);
  }

  // ---------------- WORD ----------------
  function runs(text, base) {
    // gras **, italique *, code `
    base = base || {};
    const out = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)]+\))/g;
    let last = 0, m;
    const push = (t, st) => {
      if (!t) return;
      t.split('\n').forEach((part, k) => {
        if (k > 0) out.push('<w:r><w:br/></w:r>');
        if (!part) return;
        let rpr = '';
        if (st.b || base.b) rpr += '<w:b/>';
        if (st.i) rpr += '<w:i/>';
        if (st.code) rpr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>';
        if (base.color) rpr += '<w:color w:val="' + base.color + '"/>';
        if (base.sz) rpr += '<w:sz w:val="' + base.sz + '"/>';
        out.push('<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + x(part) + '</w:t></w:r>');
      });
    };
    while ((m = re.exec(text))) {
      push(text.slice(last, m.index), {});
      const s = m[0];
      if (s.startsWith('**')) push(s.slice(2, -2), { b: true });
      else if (s.startsWith('`')) push(s.slice(1, -1), { code: true });
      else if (s.startsWith('[')) push(s.replace(/^\[([^\]]+)\]\(([^)]+)\)$/, '$1 ($2)'), {});
      else push(s.slice(1, -1), { i: true });
      last = m.index + s.length;
    }
    push(text.slice(last), {});
    return out.join('');
  }

  function para(content, opts) {
    opts = opts || {};
    let ppr = '<w:spacing w:after="' + (opts.after != null ? opts.after : 120) + '" w:line="276" w:lineRule="auto"/>';
    if (opts.ind) ppr += '<w:ind w:left="' + opts.ind + '" w:hanging="' + (opts.hanging || 0) + '"/>';
    if (opts.keepNext) ppr += '<w:keepNext/>';
    if (opts.shade) ppr += '<w:shd w:val="clear" w:color="auto" w:fill="' + opts.shade + '"/>';
    if (opts.border) ppr += '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="' + opts.border + '"/></w:pBdr>';
    return '<w:p><w:pPr>' + ppr + '</w:pPr>' + content + '</w:p>';
  }

  function docx(title, md) {
    let body = '';
    if (title) body += para(runs(title, { b: true, sz: 36, color: '1F4E79' }), { after: 240 });
    const bl = blocks(md);
    if (title && bl.length && bl[0].t === 'h' && bl[0].text.replace(/[*_`]/g, '').trim() === title) bl.shift();
    bl.forEach((b) => {
      if (b.t === 'h') {
        const sz = b.level <= 1 ? 32 : b.level === 2 ? 28 : 24;
        body += para(runs(b.text.replace(/\*\*/g, ''), { b: true, sz: sz, color: '1F4E79' }), { after: 100, keepNext: true });
      } else if (b.t === 'p') {
        body += para(runs(b.text));
      } else if (b.t === 'li') {
        const bullet = b.ordered ? b.num.replace(')', '.') + ' ' : (b.sub ? '◦ ' : '• ');
        body += para(runs(bullet + b.text), { ind: b.sub ? 1080 : 540, hanging: 270, after: 60 });
      } else if (b.t === 'quote') {
        body += para(runs(b.text, { color: '444444' }), { border: 'F97316', ind: 200 });
      } else if (b.t === 'code') {
        body += para('<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">' + x(b.text).replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">') + '</w:t></w:r>', { shade: 'F2F2F2' });
      } else if (b.t === 'table') {
        const n = Math.max.apply(null, b.rows.map((r) => r.length));
        const w = Math.floor(9600 / n);
        let t = '<w:tbl><w:tblPr><w:tblW w:w="9600" w:type="dxa"/><w:tblBorders>' +
          ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>').join('') +
          '</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>';
        for (let k = 0; k < n; k++) t += '<w:gridCol w:w="' + w + '"/>';
        t += '</w:tblGrid>';
        b.rows.forEach((r, ri) => {
          t += '<w:tr>' + (ri === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : '');
          for (let k = 0; k < n; k++) {
            const shade = ri === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="1F4E79"/>' : '';
            t += '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + shade + '</w:tcPr>' +
              para(runs(r[k] || '', ri === 0 ? { b: true, color: 'FFFFFF' } : {}), { after: 0 }) + '</w:tc>';
          }
          t += '</w:tr>';
        });
        t += '</w:tbl>';
        body += t + para('', { after: 60 });
      }
    });
    const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
    return zip([
      {
        name: '[Content_Types].xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
      },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'word/document.xml', data: doc },
      { name: 'word/styles.xml', data: styles }
    ]);
  }

  // ---------------- PDF (page imprimable) ----------------
  function printHtml(title, md) {
    md = String(md || '').replace(/^\s*#{1,6}\s+(.+)\n/, (all, h) => (h.replace(/[*_`]/g, '').trim() === title ? '' : all));
    return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>' + x(title) + '</title><style>' +
      '@page{size:A4;margin:16mm}body{font-family:Calibri,Roboto,Arial,sans-serif;font-size:11pt;color:#1a1a1a;line-height:1.45}' +
      'h1.t{font-size:18pt;color:#1F4E79;border-bottom:2px solid #F97316;padding-bottom:6px;margin:0 0 12px}' +
      'h2,h3,h4,h5{color:#1F4E79;margin:14px 0 6px;page-break-after:avoid}h2{font-size:14pt}h3,h4,h5{font-size:12pt}' +
      'table{border-collapse:collapse;width:100%;margin:6px 0 10px;font-size:10pt;page-break-inside:auto}tr{page-break-inside:avoid}' +
      'th,td{border:1px solid #A6A6A6;padding:4px 6px;text-align:left;vertical-align:top}th{background:#1F4E79;color:#fff}' +
      'code{background:#f2f2f2;padding:0 3px;border-radius:3px}pre{background:#f2f2f2;padding:8px;white-space:pre-wrap}' +
      'blockquote{border-left:3px solid #F97316;margin:6px 0;padding:2px 10px;color:#444}li.sub{margin-left:16px;list-style:circle}' +
      '.foot{margin-top:18px;font-size:8.5pt;color:#888;border-top:1px solid #ddd;padding-top:4px}a{color:#1F4E79}' +
      '</style></head><body><h1 class="t">' + x(title) + '</h1>' + window.MD.render(md) +
      '<div class="foot">Manaen · ' + new Date().toLocaleDateString('fr-FR') + '</div></body></html>';
  }

  function toB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  window.Files = { zip, xlsx, docx, printHtml, blocks, tablesFromMarkdown, smartCell, toB64, crc32 };
})();
