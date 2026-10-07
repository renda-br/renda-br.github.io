/*
 * Leitura e gravação mínimas de planilhas (.xlsx e .csv) sem bibliotecas externas.
 * Lê a PRIMEIRA aba (valores; fórmulas viram o último valor calculado salvo no arquivo).
 * Grava um .xlsx simples com uma ou mais abas.
 */
(function (raiz) {
  'use strict';
  const td = new TextDecoder('utf-8'), te = new TextEncoder();

  // ------------------------------------------------------------------ ZIP (leitura)
  async function lerZip(buf, inflateRaw) {
    const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let e = b.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Arquivo não é um .xlsx válido.');
    const n = dv.getUint16(e + 10, true); let o = dv.getUint32(e + 16, true); const arquivos = {};
    for (let i = 0; i < n; i++) {
      const metodo = dv.getUint16(o + 10, true), csize = dv.getUint32(o + 20, true);
      const ln = dv.getUint16(o + 28, true), lx = dv.getUint16(o + 30, true), lc = dv.getUint16(o + 32, true);
      const loc = dv.getUint32(o + 42, true), nome = td.decode(b.subarray(o + 46, o + 46 + ln));
      arquivos[nome] = { metodo, csize, loc }; o += 46 + ln + lx + lc;
    }
    return async (nome) => {
      const a = arquivos[nome]; if (!a) return null;
      const s = a.loc + 30 + dv.getUint16(a.loc + 26, true) + dv.getUint16(a.loc + 28, true);
      const dados = b.subarray(s, s + a.csize);
      return td.decode(a.metodo === 0 ? dados : await inflateRaw(dados));
    };
  }

  const ent = (s) => s.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-fA-F]+));/g, (m, n, d, h) =>
    d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[n]);
  const textoDe = (xml) => { let t = ''; xml.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (m, x) => { t += ent(x); }); return t; };
  const colIdx = (ref) => { let c = 0; for (const ch of ref.match(/^[A-Z]+/)[0]) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };

  async function lerXlsx(buf, inflateRaw) {
    const ler = await lerZip(buf, inflateRaw);
    const wb = await ler('xl/workbook.xml'); if (!wb) throw new Error('Arquivo não é um .xlsx válido.');
    const sheet = wb.match(/<sheet\b[^>]*>/); const nomeAba = sheet ? ent((sheet[0].match(/name="([^"]*)"/) || [])[1] || 'Planilha') : 'Planilha';
    const rid = sheet && (sheet[0].match(/r:id="([^"]*)"/) || [])[1];
    let alvo = 'xl/worksheets/sheet1.xml';
    const rels = await ler('xl/_rels/workbook.xml.rels');
    if (rels && rid) {
      const r = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`));
      const t = r && (r[0].match(/Target="([^"]*)"/) || [])[1];
      if (t) alvo = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    }
    const ss = []; const sst = await ler('xl/sharedStrings.xml');
    if (sst) sst.replace(/<si>([\s\S]*?)<\/si>/g, (m, x) => { ss.push(textoDe(x)); });
    const xml = await ler(alvo); if (!xml) throw new Error('Não encontrei a primeira aba da planilha.');
    const linhas = [];
    xml.replace(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g, (m, corpo) => {
      const rn = +((m.match(/\br="(\d+)"/) || [])[1] || linhas.length + 1); const lin = [];
      (corpo || '').replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (mm, at, dentro) => {
        const ref = (at.match(/\br="([A-Z]+\d+)"/) || [])[1]; const t = (at.match(/\bt="([^"]*)"/) || [])[1];
        const ci = ref ? colIdx(ref) : lin.length; let v = null;
        const vv = dentro && dentro.match(/<v>([\s\S]*?)<\/v>/);
        if (t === 's') v = vv ? ss[+vv[1]] : null;
        else if (t === 'inlineStr') v = textoDe(dentro || '');
        else if (t === 'str' || t === 'e') v = vv ? ent(vv[1]) : null;
        else if (t === 'b') v = vv ? vv[1] === '1' : null;
        else v = vv ? Number(vv[1]) : null;
        lin[ci] = v;
      });
      linhas[rn - 1] = lin;
    });
    for (let i = 0; i < linhas.length; i++) if (!linhas[i]) linhas[i] = [];
    return { nomeAba, linhas };
  }

  function lerCsv(texto) {
    texto = texto.replace(/^﻿/, ''); const prim = texto.split(/\r?\n/)[0] || '';
    const sep = (prim.match(/;/g) || []).length >= (prim.match(/,/g) || []).length && prim.includes(';') ? ';' : (prim.includes('\t') ? '\t' : ',');
    const linhas = []; let lin = [], campo = '', aspas = false;
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (aspas) { if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch; }
      else if (ch === '"') aspas = true;
      else if (ch === sep) { lin.push(campo); campo = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texto[i + 1] === '\n') i++; lin.push(campo); linhas.push(lin); lin = []; campo = ''; }
      else campo += ch;
    }
    if (campo !== '' || lin.length) { lin.push(campo); linhas.push(lin); }
    return { nomeAba: 'Planilha', linhas };
  }

  // ------------------------------------------------------------------ XLSX (gravação)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  function zipStore(arquivos) {
    const partes = [], central = []; let off = 0;
    for (const [nome, conteudo] of arquivos) {
      const nb = te.encode(nome), dados = typeof conteudo === 'string' ? te.encode(conteudo) : conteudo, crc = crc32(dados);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, dados.length, true); h.setUint32(22, dados.length, true); h.setUint16(26, nb.length, true);
      partes.push(new Uint8Array(h.buffer), nb, dados);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, dados.length, true); c.setUint32(24, dados.length, true); c.setUint16(28, nb.length, true);
      c.setUint32(42, off, true); central.push(new Uint8Array(c.buffer), nb);
      off += 30 + nb.length + dados.length;
    }
    const tamC = central.reduce((s, x) => s + x.length, 0), fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
    fim.setUint32(12, tamC, true); fim.setUint32(16, off, true);
    const todas = [...partes, ...central, new Uint8Array(fim.buffer)], out = new Uint8Array(todas.reduce((s, x) => s + x.length, 0));
    let p = 0; for (const x of todas) { out.set(x, p); p += x.length; } return out;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  const colNome = (i) => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

  /** abas: [{nome, linhas:[[...]], larguras?:[...], formatoMoeda?: Set(colunas)}] */
  function escreverXlsx(abas) {
    const sheets = abas.map((a, k) => {
      let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
      if (a.larguras) x += '<cols>' + a.larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
      x += '<sheetData>';
      a.linhas.forEach((lin, r) => {
        x += `<row r="${r + 1}">`;
        (lin || []).forEach((v, c) => {
          if (v === null || v === undefined || v === '') return;
          const ref = colNome(c) + (r + 1), est = r === 0 ? ' s="1"' : (a.formatoMoeda && a.formatoMoeda.has(c) && typeof v === 'number' ? ' s="2"' : '');
          if (typeof v === 'number' && isFinite(v)) x += `<c r="${ref}"${est}><v>${v}</v></c>`;
          else if (typeof v === 'boolean') x += `<c r="${ref}" t="b"${est}><v>${v ? 1 : 0}</v></c>`;
          else x += `<c r="${ref}" t="inlineStr"${est}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        });
        x += '</row>';
      });
      return [`xl/worksheets/sheet${k + 1}.xml`, x + '</sheetData></worksheet>'];
    });
    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + abas.map((a, k) => `<Override PartName="/xl/worksheets/sheet${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + abas.map((a, k) => `<sheet name="${esc(a.nome.slice(0, 31))}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join('') + '</sheets></workbook>';
    const wbr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + abas.map((a, k) => `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${k + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    const st = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    return zipStore([['[Content_Types].xml', ct], ['_rels/.rels', rels], ['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', wbr], ['xl/styles.xml', st], ...sheets]);
  }

  async function lerPlanilha(nomeArquivo, buf, inflateRaw) {
    const n = nomeArquivo.toLowerCase();
    if (n.endsWith('.csv') || n.endsWith('.txt')) return lerCsv(td.decode(buf));
    if (n.endsWith('.xlsx') || n.endsWith('.xlsm')) return lerXlsx(buf, inflateRaw);
    throw new Error('Formato não suportado. Use .xlsx ou .csv (no Excel: Salvar como → Pasta de Trabalho do Excel).');
  }

  const api = { lerPlanilha, lerXlsx, lerCsv, escreverXlsx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.Planilha = api;
})(typeof self !== 'undefined' ? self : this);
