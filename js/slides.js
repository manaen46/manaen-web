// Fabrication de présentations PowerPoint (.pptx), format 16:9, aux couleurs de Manaen.
// Une diapo : {titre, sous_titre?, points?: [texte], image?: url, schema_svg?: svg, legende?, tableau?: [[…]], type?: 'titre'}
(function () {
  'use strict';

  const W = 12192000, H = 6858000;   // 33,867 × 19,05 cm (EMU)
  const BLUE = '1F4E79', ORANGE = 'F97316', DARK = '1A1A1A', GREY = '666666';
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  function x(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  const plain = (s) => String(s || '').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

  // ---------------- Formes ----------------
  let shapeId = 2;
  const off = (xx, yy, w, h) => '<a:xfrm><a:off x="' + Math.round(xx) + '" y="' + Math.round(yy) + '"/><a:ext cx="' + Math.round(w) + '" cy="' + Math.round(h) + '"/></a:xfrm>';

  function rect(xx, yy, w, h, color) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + shapeId++ + '" name="Bande"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>' + off(xx, yy, w, h) +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>';
  }

  // paras : [{text, size, bold, color, bullet, level, align}]
  function textBox(xx, yy, w, h, paras, anchor) {
    const body = paras.map((pp) => {
      const lvl = pp.level || 0;
      const ppr = pp.bullet
        ? '<a:pPr marL="' + (342900 + lvl * 342900) + '" indent="-285750"' + (pp.align ? ' algn="' + pp.align + '"' : '') + '><a:spcBef><a:spcPts val="600"/></a:spcBef><a:buClr><a:srgbClr val="' + ORANGE + '"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="' + (lvl ? '–' : '•') + '"/></a:pPr>'
        : '<a:pPr' + (pp.align ? ' algn="' + pp.align + '"' : '') + '><a:spcBef><a:spcPts val="300"/></a:spcBef><a:buNone/></a:pPr>';
      return '<a:p>' + ppr + '<a:r><a:rPr lang="fr-FR" sz="' + (pp.size || 2000) + '"' + (pp.bold ? ' b="1"' : '') + (pp.italic ? ' i="1"' : '') + ' dirty="0">' +
        '<a:solidFill><a:srgbClr val="' + (pp.color || DARK) + '"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>' + x(pp.text) + '</a:t></a:r></a:p>';
    }).join('');
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + shapeId++ + '" name="Texte"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>' + off(xx, yy, w, h) +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="91440" rIns="91440" tIns="45720" bIns="45720" anchor="' + (anchor || 't') + '"><a:normAutofit/></a:bodyPr><a:lstStyle/>' +
      (body || '<a:p><a:endParaRPr lang="fr-FR"/></a:p>') + '</p:txBody></p:sp>';
  }

  // Image centrée dans le cadre donné, proportions respectées
  function picture(rid, img, bx, by, bw, bh) {
    const k = Math.min(bw / img.w, bh / img.h);
    const w = img.w * k, h = img.h * k;
    return '<p:pic><p:nvPicPr><p:cNvPr id="' + shapeId++ + '" name="Image"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
      '<p:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>' + off(bx + (bw - w) / 2, by + (bh - h) / 2, w, h) +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
  }

  function table(rows, xx, yy, w) {
    const n = Math.max.apply(null, rows.map((r) => r.length));
    const cw = Math.floor(w / n), rh = 420000;
    const size = rows.length > 8 || n > 5 ? 1300 : 1600;
    const cell = (t, head) => '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="fr-FR" sz="' + size + '"' + (head ? ' b="1"' : '') + '><a:solidFill><a:srgbClr val="' + (head ? 'FFFFFF' : DARK) + '"/></a:solidFill></a:rPr><a:t>' + x(plain(t)) + '</a:t></a:r></a:p></a:txBody>' +
      '<a:tcPr marL="68580" marR="68580" marT="34290" marB="34290">' + ['lnL', 'lnR', 'lnT', 'lnB'].map((l) => '<a:' + l + ' w="9525"><a:solidFill><a:srgbClr val="A6A6A6"/></a:solidFill></a:' + l + '>').join('') +
      '<a:solidFill><a:srgbClr val="' + (head ? BLUE : 'FFFFFF') + '"/></a:solidFill></a:tcPr></a:tc>';
    return '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' + shapeId++ + '" name="Tableau"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>' +
      '<p:xfrm><a:off x="' + xx + '" y="' + yy + '"/><a:ext cx="' + cw * n + '" cy="' + rh * rows.length + '"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>' +
      Array(n).fill('<a:gridCol w="' + cw + '"/>').join('') + '</a:tblGrid>' +
      rows.map((r, ri) => '<a:tr h="' + rh + '">' + Array.from({ length: n }, (_, k) => cell(r[k] || '', ri === 0)).join('') + '</a:tr>').join('') +
      '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
  }

  // ---------------- Animations ----------------
  // steps : [{spid, para (n° de paragraphe ou null), click (au clic) ou automatique au début}]
  function timing(steps, builds) {
    if (!steps.length) return '';
    let id = 3;
    const pars = steps.map((st) => {
      const tgt = '<p:spTgt spid="' + st.spid + '">' + (st.para != null ? '<p:txEl><p:pRg st="' + st.para + '" end="' + st.para + '"/></p:txEl>' : '') + '</p:spTgt>';
      const start = st.click
        ? '<p:cond delay="indefinite"/>'
        : '<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>';
      const outer = id++, mid = id++, eff = id++, set = id++, fade = id++;
      return '<p:par><p:cTn id="' + outer + '" fill="hold"><p:stCondLst>' + start + '</p:stCondLst><p:childTnLst>' +
        '<p:par><p:cTn id="' + mid + '" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
        '<p:par><p:cTn id="' + eff + '" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="' + (st.click ? 'clickEffect' : 'afterEffect') + '">' +
        '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
        '<p:set><p:cBhvr><p:cTn id="' + set + '" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl>' + tgt + '</p:tgtEl>' +
        '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>' +
        '<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="' + fade + '" dur="500"/><p:tgtEl>' + tgt + '</p:tgtEl></p:cBhvr></p:animEffect>' +
        '</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>';
    }).join('');
    return '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>' +
      '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>' + pars + '</p:childTnLst></p:cTn>' +
      '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>' +
      '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>' +
      '</p:childTnLst></p:cTn></p:par></p:tnLst>' + (builds ? '<p:bldLst>' + builds + '</p:bldLst>' : '') + '</p:timing>';
  }

  // ---------------- Une diapo ----------------
  // animate : transitions en fondu, image et tableau qui apparaissent, points un par un au clic
  function slideXml(d, num, total, imgRid, img, animate) {
    shapeId = 2;
    let tree = '';
    const steps = [];
    let builds = '';
    if (d.type === 'titre') {
      tree += rect(0, 0, W, H, BLUE) + rect(0, H * 0.62, W, 60000, ORANGE);
      tree += textBox(800000, H * 0.25, W - 1600000, 1500000, [{ text: plain(d.titre), size: 4400, bold: true, color: 'FFFFFF' }], 'b');
      if (d.sous_titre) tree += textBox(800000, H * 0.66, W - 1600000, 1000000, [{ text: plain(d.sous_titre), size: 2200, color: 'DCE6F0' }]);
    } else {
      tree += rect(0, 0, W, 1050000, BLUE) + rect(0, 1050000, W, 50000, ORANGE);
      tree += textBox(500000, 120000, W - 1000000, 850000, [{ text: plain(d.titre), size: 3000, bold: true, color: 'FFFFFF' }], 'ctr');
      const top = 1350000, bottom = H - 450000, hasImg = !!img;
      const points = (d.points || []).filter((t) => String(t).trim());
      const textW = hasImg && points.length ? W * 0.52 : W - 1000000;
      if (d.tableau && d.tableau.length) {
        steps.push({ spid: shapeId, para: null, click: false });
        builds += '<p:bldGraphic spid="' + shapeId + '" grpId="0"><p:bldAsOne/></p:bldGraphic>';
        tree += table(d.tableau, 500000, top, hasImg ? W * 0.55 : W - 1000000);
      } else if (points.length) {
        const size = points.length > 7 ? 1800 : points.length > 5 ? 2000 : 2400;
        const bodyId = shapeId;
        points.forEach((_, k) => steps.push({ spid: bodyId, para: k, click: true }));
        builds += '<p:bldP spid="' + bodyId + '" grpId="0" build="p"/>';
        tree += textBox(500000, top, textW, bottom - top, points.map((t) => {
          const lvl = /^\s{2,}|^\s*[-–]\s/.test(t) ? 1 : 0;
          return { text: plain(String(t).replace(/^\s*[-–•]\s*/, '')), size: lvl ? size - 200 : size, bullet: true, level: lvl };
        }));
      }
      if (hasImg) {
        const capH = d.legende ? 450000 : 0;
        const bx = points.length || (d.tableau && d.tableau.length) ? W * 0.58 : 800000;
        const bw = points.length || (d.tableau && d.tableau.length) ? W * 0.38 : W - 1600000;
        steps.unshift({ spid: shapeId, para: null, click: false }); // l'image arrive en fondu à l'ouverture de la diapo
        tree += picture(imgRid, img, bx, top, bw, bottom - top - capH);
        if (d.legende) tree += textBox(bx, bottom - capH, bw, capH, [{ text: d.legende, size: 1100, italic: true, color: GREY, align: 'ctr' }]);
      }
    }
    if (d.type !== 'titre') tree += textBox(W - 2200000, H - 420000, 1900000, 350000, [{ text: num + ' / ' + total, size: 1100, color: GREY, align: 'r' }]);
    return HEAD + '<p:sld ' + NS + '><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>' +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      tree + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>' +
      (animate ? '<p:transition spd="med"><p:fade/></p:transition>' + timing(steps, builds) : '') + '</p:sld>';
  }

  // ---------------- Pièces fixes du fichier ----------------
  const THEME = HEAD + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Manaen"><a:themeElements>' +
    '<a:clrScheme name="Manaen"><a:dk1><a:srgbClr val="1A1A1A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F4E79"/></a:dk2><a:lt2><a:srgbClr val="E7EEF5"/></a:lt2>' +
    '<a:accent1><a:srgbClr val="1F4E79"/></a:accent1><a:accent2><a:srgbClr val="F97316"/></a:accent2><a:accent3><a:srgbClr val="38BDF8"/></a:accent3><a:accent4><a:srgbClr val="34D399"/></a:accent4>' +
    '<a:accent5><a:srgbClr val="8DA0B5"/></a:accent5><a:accent6><a:srgbClr val="F87171"/></a:accent6><a:hlink><a:srgbClr val="1F4E79"/></a:hlink><a:folHlink><a:srgbClr val="5B3A8C"/></a:folHlink></a:clrScheme>' +
    '<a:fontScheme name="Manaen"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
    '<a:fmtScheme name="Manaen"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
    '<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>' +
    '</a:themeElements></a:theme>';
  const EMPTY_TREE = '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>';
  const MASTER = HEAD + '<p:sldMaster ' + NS + '>' + EMPTY_TREE +
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>';
  const LAYOUT = HEAD + '<p:sldLayout ' + NS + ' type="blank" preserve="1">' + EMPTY_TREE + '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const rels = (list) => HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    list.map((r) => '<Relationship Id="' + r[0] + '" Type="' + REL + r[1] + '" Target="' + r[2] + '"/>').join('') + '</Relationships>';

  // slides : liste de diapos ; images : { index de diapo : {bytes, ext, w, h} }
  // opts.animations : false pour une présentation sans animation (true par défaut)
  function pptx(slides, images, opts) {
    images = images || {};
    const animate = !opts || opts.animations !== false;
    const n = slides.length;
    const files = [
      {
        name: '[Content_Types].xml',
        data: HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
          '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
          '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
          '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
          '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
          slides.map((_, i) => '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('') + '</Types>'
      },
      { name: '_rels/.rels', data: rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]) },
      {
        name: 'ppt/presentation.xml',
        data: HEAD + '<p:presentation ' + NS + ' saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' +
          slides.map((_, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 3) + '"/>').join('') +
          '</p:sldIdLst><p:sldSz cx="' + W + '" cy="' + H + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>'
      },
      { name: 'ppt/_rels/presentation.xml.rels', data: rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml']].concat(slides.map((_, i) => ['rId' + (i + 3), 'slide', 'slides/slide' + (i + 1) + '.xml']))) },
      { name: 'ppt/slideMasters/slideMaster1.xml', data: MASTER },
      { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]) },
      { name: 'ppt/slideLayouts/slideLayout1.xml', data: LAYOUT },
      { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) },
      { name: 'ppt/theme/theme1.xml', data: THEME }
    ];
    slides.forEach((d, i) => {
      const img = images[i];
      const r = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']];
      if (img) {
        const name = 'image' + (i + 1) + '.' + img.ext;
        r.push(['rId2', 'image', '../media/' + name]);
        files.push({ name: 'ppt/media/' + name, data: img.bytes });
      }
      files.push({ name: 'ppt/slides/slide' + (i + 1) + '.xml', data: slideXml(d, i + 1, n, 'rId2', img, animate) });
      files.push({ name: 'ppt/slides/_rels/slide' + (i + 1) + '.xml.rels', data: rels(r) });
    });
    return window.Files.zip(files);
  }

  // Prépare les images des diapos (photos téléchargées, schémas convertis)
  async function loadSlideImages(slides, fetchBytes, credits) {
    const out = {};
    for (let i = 0; i < slides.length; i++) {
      const d = slides[i];
      try {
        if (d.schema_svg) out[i] = await window.Files.prepareImage({ svg: d.schema_svg }, fetchBytes);
        else if (d.image) {
          out[i] = await window.Files.prepareImage({ url: d.image }, fetchBytes);
          const credit = credits && credits[d.image];
          if (credit) d.legende = (d.legende ? d.legende + ' — ' : '') + credit;
        }
      } catch (e) { /* image indisponible : diapo sans image */ }
    }
    return out;
  }

  // Transforme une réponse Markdown en diapos : un titre = une diapo
  function fromMarkdown(title, md) {
    const slides = [{ type: 'titre', titre: title, sous_titre: 'Manaen · ' + new Date().toLocaleDateString('fr-FR') }];
    let cur = null;
    const flush = () => { if (cur && (cur.points.length || cur.image || cur.schema_svg || cur.tableau)) slides.push(cur); };
    window.Files.blocks(md).forEach((b) => {
      if (b.t === 'h') {
        if (plain(b.text) === title && slides.length === 1 && !cur) return;
        flush();
        cur = { titre: plain(b.text), points: [] };
        return;
      }
      if (!cur) cur = { titre: title, points: [] };
      if (b.t === 'li') cur.points.push((b.sub ? '  ' : '') + b.text);
      else if (b.t === 'p' || b.t === 'quote') b.text.split('\n').forEach((l) => l.trim() && cur.points.push(l));
      else if (b.t === 'image' && !cur.image && !cur.schema_svg) { cur.image = b.url; cur.legende = b.alt; }
      else if (b.t === 'svg' && !cur.image && !cur.schema_svg) cur.schema_svg = b.svg;
      else if (b.t === 'table' && !cur.tableau) cur.tableau = b.rows;
      // trop de texte pour une diapo : on continue sur une nouvelle
      if (cur.points.length >= 8) { flush(); cur = { titre: cur.titre + ' (suite)', points: [] }; }
    });
    flush();
    return slides;
  }

  window.Slides = { pptx, loadSlideImages, fromMarkdown };
})();
