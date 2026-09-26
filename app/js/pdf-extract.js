/*
 * PDF → paragraphs extractor for Malayalam text.
 *
 * Malayalam PDFs exported from Google Docs / Chrome (Skia) draw glyphs in
 * visual order and wrap each cluster in a /Span <</ActualText ...>> marked
 * content block that holds the real Unicode text. Generic extractors
 * (including pdf.js) ignore ActualText and produce garbled Malayalam, so this
 * reads the content streams directly:
 *   - text inside an ActualText span  → the ActualText string
 *   - any other glyphs                → decoded through the font's ToUnicode CMap
 *   - each /P marked-content block    → one paragraph
 *
 * Works in the browser and in Node 18+ (uses DecompressionStream).
 * Returns { pages: [[paragraph, ...], ...], title }.
 */
(function (root) {
  'use strict';

  const latin1 = new TextDecoder('latin1');

  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function hexToBytes(hex) {
    hex = hex.replace(/[^0-9a-fA-F]/g, '');
    if (hex.length % 2) hex += '0';
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  // PDF text string (bytes) → JS string. UTF-16BE with BOM, else PDFDocEncoding≈latin1.
  function decodeTextString(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      let s = '';
      for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      return s;
    }
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    return latin1.decode(bytes);
  }

  function literalToBytes(lit) {
    // lit is the raw content between the outer parentheses
    const out = [];
    for (let i = 0; i < lit.length; i++) {
      let c = lit.charCodeAt(i);
      if (c !== 0x5c) { out.push(c & 0xff); continue; }
      const n = lit[++i];
      if (n === undefined) break;
      const map = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
      if (n in map) out.push(map[n]);
      else if (/[0-7]/.test(n)) {
        let oct = n;
        while (oct.length < 3 && /[0-7]/.test(lit[i + 1])) oct += lit[++i];
        out.push(parseInt(oct, 8) & 0xff);
      } else if (n === '\r') { if (lit[i + 1] === '\n') i++; }
      else if (n !== '\n') out.push(n.charCodeAt(0) & 0xff);
    }
    return new Uint8Array(out);
  }

  // ---------- object parsing ----------

  function parseObjects(bytes) {
    const str = latin1.decode(bytes);
    const objects = new Map();
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(str))) {
      const id = +m[1];
      const start = m.index + m[0].length;
      const end = str.indexOf('endobj', start);
      if (end < 0) break;
      let body = str.slice(start, end);
      let stream = null;
      const sIdx = body.search(/\bstream\r?\n/);
      if (sIdx >= 0) {
        const dict = body.slice(0, sIdx);
        const hdr = body.slice(sIdx).match(/^stream\r?\n/)[0];
        const dataStart = start + sIdx + hdr.length;
        const lenM = dict.match(/\/Length\s+(\d+)(\s+\d+\s+R)?/);
        let len = lenM && !lenM[2] ? +lenM[1] : -1;
        let dataEnd = len >= 0 ? dataStart + len : str.indexOf('endstream', dataStart);
        if (len < 0) {
          // indirect length: trim trailing EOL before endstream
          while (dataEnd > dataStart && (str[dataEnd - 1] === '\n' || str[dataEnd - 1] === '\r')) dataEnd--;
        }
        stream = bytes.subarray(dataStart, dataEnd);
        body = dict;
      }
      objects.set(id, { body, stream });
      re.lastIndex = end;
    }
    return objects;
  }

  async function streamData(obj) {
    if (!obj || !obj.stream) return new Uint8Array(0);
    if (/\/Filter\s*\[?\s*\/FlateDecode/.test(obj.body)) return inflate(obj.stream);
    if (/\/Filter/.test(obj.body)) throw new Error('Unsupported stream filter');
    return obj.stream;
  }

  // Expand compressed object streams (/Type /ObjStm) so their objects are addressable.
  async function expandObjectStreams(objects) {
    for (const [, obj] of [...objects]) {
      if (!/\/Type\s*\/ObjStm/.test(obj.body)) continue;
      const n = +(obj.body.match(/\/N\s+(\d+)/) || [])[1];
      const first = +(obj.body.match(/\/First\s+(\d+)/) || [])[1];
      const data = latin1.decode(await streamData(obj));
      const head = data.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i < n; i++) {
        const id = head[i * 2], off = head[i * 2 + 1];
        const next = i + 1 < n ? head[(i + 1) * 2 + 1] : data.length - first;
        if (!objects.has(id)) objects.set(id, { body: data.slice(first + off, first + next), stream: null });
      }
    }
  }

  const refRe = (key) => new RegExp('/' + key + '\\s+(\\d+)\\s+\\d+\\s+R');

  function getRef(body, key) {
    const m = body.match(refRe(key));
    return m ? +m[1] : null;
  }

  // Extract a balanced << ... >> dictionary following /Key (inline), or resolve if it's a ref.
  function getDict(objects, body, key) {
    const idx = body.search(new RegExp('/' + key + '(?![A-Za-z])'));
    if (idx < 0) return null;
    let i = idx + key.length + 1;
    while (/\s/.test(body[i])) i++;
    if (body.startsWith('<<', i)) {
      let depth = 0, j = i;
      for (; j < body.length; j++) {
        if (body.startsWith('<<', j)) { depth++; j++; }
        else if (body.startsWith('>>', j)) { depth--; j++; if (!depth) break; }
      }
      return body.slice(i, j + 1);
    }
    const m = body.slice(i).match(/^(\d+)\s+\d+\s+R/);
    if (m) { const o = objects.get(+m[1]); return o ? o.body : null; }
    return null;
  }

  function collectPages(objects) {
    let catalog = null;
    for (const [, o] of objects) if (/\/Type\s*\/Catalog/.test(o.body)) { catalog = o; break; }
    const pages = [];
    const walk = (id, inherited) => {
      const o = objects.get(id);
      if (!o) return;
      const res = getDict(objects, o.body, 'Resources') || inherited;
      if (/\/Type\s*\/Pages/.test(o.body)) {
        const kids = (o.body.match(/\/Kids\s*\[([^\]]*)\]/) || [])[1] || '';
        for (const k of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(+k[1], res);
      } else if (/\/Type\s*\/Page\b/.test(o.body)) {
        pages.push({ obj: o, resources: res || '' });
      }
    };
    const rootId = catalog && getRef(catalog.body, 'Pages');
    if (rootId != null) walk(rootId, null);
    return pages;
  }

  function parseCMap(text) {
    const map = new Map();
    let codeLen = 2;
    const cs = text.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/);
    if (cs) codeLen = cs[1].length / 2;
    const toStr = (hex) => decodeTextString(new Uint8Array([0xfe, 0xff, ...hexToBytes(hex)]));
    for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), toStr(m[2]));
    }
    for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
        const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
        if (m[3][0] === '[') {
          const arr = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]);
          for (let c = lo; c <= hi && c - lo < arr.length; c++) map.set(c, toStr(arr[c - lo]));
        } else {
          const dst = hexToBytes(m[3].slice(1, -1));
          for (let c = lo; c <= hi; c++) {
            const d = dst.slice();
            let add = c - lo, k = d.length - 1;
            while (add && k >= 0) { const v = d[k] + add; d[k] = v & 0xff; add = v >> 8; k--; }
            map.set(c, decodeTextString(new Uint8Array([0xfe, 0xff, ...d])));
          }
        }
      }
    }
    return { map, codeLen };
  }

  async function loadFonts(objects, resources) {
    const fonts = {};
    const fontDict = getDict(objects, resources, 'Font');
    if (!fontDict) return fonts;
    for (const m of fontDict.matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      const fo = objects.get(+m[2]);
      if (!fo) continue;
      const tuId = getRef(fo.body, 'ToUnicode');
      let cmap = { map: new Map(), codeLen: /Type0/.test(fo.body) ? 2 : 1 };
      if (tuId != null) {
        try { cmap = parseCMap(latin1.decode(await streamData(objects.get(tuId)))); } catch (e) { /* ignore */ }
        if (/Type0/.test(fo.body)) cmap.codeLen = 2;
      }
      fonts[m[1]] = cmap;
    }
    return fonts;
  }

  // ---------- content stream tokenizer ----------

  function* tokenize(s) {
    let i = 0;
    const n = s.length;
    while (i < n) {
      const c = s[i];
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0') { i++; continue; }
      if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      if (c === '(') {
        let depth = 1, j = i + 1;
        for (; j < n && depth; j++) {
          if (s[j] === '\\') { j++; continue; }
          if (s[j] === '(') depth++;
          else if (s[j] === ')') depth--;
        }
        yield { t: 'str', v: literalToBytes(s.slice(i + 1, j - 1)) };
        i = j; continue;
      }
      if (c === '<' && s[i + 1] === '<') { yield { t: 'dictStart' }; i += 2; continue; }
      if (c === '>' && s[i + 1] === '>') { yield { t: 'dictEnd' }; i += 2; continue; }
      if (c === '<') {
        const j = s.indexOf('>', i);
        yield { t: 'str', v: hexToBytes(s.slice(i + 1, j)) };
        i = j + 1; continue;
      }
      if (c === '[') { yield { t: 'arrStart' }; i++; continue; }
      if (c === ']') { yield { t: 'arrEnd' }; i++; continue; }
      if (c === '/') {
        let j = i + 1;
        while (j < n && !/[\s/<>\[\]()%{}]/.test(s[j])) j++;
        yield { t: 'name', v: s.slice(i + 1, j) };
        i = j; continue;
      }
      let j = i;
      while (j < n && !/[\s/<>\[\]()%{}]/.test(s[j])) j++;
      if (j === i) { i++; continue; }
      const w = s.slice(i, j);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) yield { t: 'num', v: parseFloat(w) };
      else yield { t: 'op', v: w };
      i = j;
    }
  }

  function decodeGlyphs(bytes, font) {
    if (!font) return latin1.decode(bytes);
    let out = '';
    const L = font.codeLen || 1;
    for (let i = 0; i + L - 1 < bytes.length; i += L) {
      let code = 0;
      for (let k = 0; k < L; k++) code = (code << 8) | bytes[i + k];
      const u = font.map.get(code);
      if (u !== undefined) out += u;
      else if (L === 1) out += String.fromCharCode(code);
    }
    return out;
  }

  const mul = (m, n) => [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ];
  const ID = [1, 0, 0, 1, 0, 0];

  // Runs one page's content stream, returns its paragraphs:
  //   { text, x0, x1 }  x0 = left of first line, x1 = right edge of the LAST line
  function runContent(content, fonts) {
    const paras = [];
    let cur = null;          // current paragraph {text, x0, x1}
    let font = null, fontSize = 12;
    let lastY = null;        // y of the last text drawn (for line-break detection)
    let ctm = ID, tm = ID, tlm = ID, leading = 0;
    const mcStack = [];      // marked content stack: {para, actual}
    let suppress = 0;        // >0 while inside an ActualText span
    const stack = [];        // operand stack
    const gsStack = [];
    let dictDepth = 0, dictItems = null, arrDepth = 0, arr = null;

    let pendingActual = null; // ActualText waiting for its first glyph (to know its position)
    const ensurePara = () => { if (cur === null) cur = { text: '', x0: null, x1: null }; };
    const endPara = () => { if (cur !== null) { paras.push(cur); cur = null; lastY = null; } };
    const pos = () => { const m = mul(tm, ctm); return { x: m[4], y: m[5], scale: Math.hypot(m[0], m[1]) || 1 }; };
    const emit = (text, keepLine) => {
      if (!text) return;
      ensurePara();
      if (!keepLine) {
        const p = pos();
        const newLine = lastY === null || Math.abs(p.y - lastY) > 1;
        if (newLine && lastY !== null && cur.text && !/\s$/.test(cur.text)) cur.text += ' ';
        if (cur.x0 === null) cur.x0 = p.x;
        const right = p.x + fontSize * p.scale * 0.5;
        cur.x1 = newLine ? right : Math.max(cur.x1 || 0, right);
        lastY = p.y;
      }
      cur.text += text;
    };
    const flushActual = (keepLine) => {
      if (pendingActual !== null) { const t = pendingActual; pendingActual = null; emit(t, keepLine); }
    };

    for (const tok of tokenize(content)) {
      if (tok.t === 'dictStart') { if (!dictDepth++) dictItems = []; else dictItems.push(tok); continue; }
      if (tok.t === 'dictEnd') { if (!--dictDepth) { stack.push({ t: 'dict', v: dictItems }); dictItems = null; } else dictItems.push(tok); continue; }
      if (dictDepth) { dictItems.push(tok); continue; }
      if (tok.t === 'arrStart') { if (!arrDepth++) arr = []; continue; }
      if (tok.t === 'arrEnd') { if (!--arrDepth) { stack.push({ t: 'arr', v: arr }); arr = null; } continue; }
      if (arrDepth) { arr.push(tok); continue; }
      if (tok.t !== 'op') { stack.push(tok); continue; }

      const op = tok.v;
      const nums = () => stack.filter((x) => x.t === 'num').map((x) => x.v);
      switch (op) {
        case 'BDC':
        case 'BMC': {
          const tag = stack.find((x) => x.t === 'name');
          const props = stack.find((x) => x.t === 'dict');
          let actual = null;
          if (props) {
            const items = props.v;
            for (let k = 0; k < items.length - 1; k++) {
              if (items[k].t === 'name' && items[k].v === 'ActualText' && items[k + 1].t === 'str') actual = decodeTextString(items[k + 1].v);
            }
          }
          const isPara = tag && /^(P|H\d?|LI|LBody)$/.test(tag.v);
          if (isPara) { endPara(); ensurePara(); }
          if (actual !== null) { if (!suppress) pendingActual = actual; suppress++; }
          mcStack.push({ isPara, actual: actual !== null });
          break;
        }
        case 'EMC': {
          const mc = mcStack.pop();
          if (mc && mc.actual) { suppress--; if (!suppress) flushActual(true); }
          if (mc && mc.isPara) endPara();
          break;
        }
        case 'q': gsStack.push(ctm); break;
        case 'Q': ctm = gsStack.length ? gsStack.pop() : ID; break;
        case 'cm': { const a = nums(); if (a.length >= 6) ctm = mul(a.slice(-6), ctm); break; }
        case 'BT': tm = tlm = ID; break;
        case 'Tm': { const a = nums(); if (a.length >= 6) tm = tlm = a.slice(-6); break; }
        case 'TL': { const a = nums(); if (a.length) leading = a[a.length - 1]; break; }
        case 'Td': case 'TD': {
          const a = nums();
          if (a.length >= 2) {
            const [tx, ty] = a.slice(-2);
            if (op === 'TD') leading = -ty;
            tm = tlm = mul([1, 0, 0, 1, tx, ty], tlm);
          }
          break;
        }
        case 'T*': tm = tlm = mul([1, 0, 0, 1, 0, -leading], tlm); break;
        case 'Tf': {
          const nm = stack.find((x) => x.t === 'name');
          const sz = nums();
          font = nm ? fonts[nm.v] : null;
          if (sz.length) fontSize = sz[sz.length - 1];
          break;
        }
        case 'Tj': case "'": case '"': {
          const s = [...stack].reverse().find((x) => x.t === 'str');
          if (op !== 'Tj') tm = tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
          if (suppress) flushActual(false);
          else if (s) emit(decodeGlyphs(s.v, font));
          break;
        }
        case 'TJ': {
          const a = stack.find((x) => x.t === 'arr');
          if (suppress) flushActual(false);
          else if (a) {
            let text = '';
            for (const it of a.v) {
              if (it.t === 'str') text += decodeGlyphs(it.v, font);
              else if (it.t === 'num' && it.v < -250) text += ' '; // large kerning gap ≈ word space
            }
            emit(text);
          }
          break;
        }
        default: break;
      }
      stack.length = 0;
    }
    endPara();
    return paras
      .map((p) => ({ text: p.text.replace(/\s+/g, ' ').trim(), x0: round(p.x0), x1: round(p.x1) }))
      .filter((p) => p.text);
  }
  const round = (v) => (v == null ? null : Math.round(v * 10) / 10);

  async function extract(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    if (latin1.decode(bytes.subarray(0, 1024)).indexOf('%PDF') < 0) throw new Error('Not a PDF file');
    const objects = parseObjects(bytes);
    for (const [, o] of objects) if (/\/Encrypt\b/.test(o.body) && /\/Root/.test(o.body)) throw new Error('Encrypted PDFs are not supported');
    await expandObjectStreams(objects);
    const pages = collectPages(objects);
    if (!pages.length) throw new Error('No pages found in PDF');
    const out = [];
    let actualTextSeen = false;
    for (const pg of pages) {
      const fonts = await loadFonts(objects, pg.resources);
      const contentsArr = (pg.obj.body.match(/\/Contents\s*\[([^\]]*)\]/) || [])[1];
      const ids = contentsArr
        ? [...contentsArr.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => +m[1])
        : [getRef(pg.obj.body, 'Contents')].filter((x) => x != null);
      let content = '';
      for (const id of ids) content += latin1.decode(await streamData(objects.get(id))) + '\n';
      if (content.indexOf('ActualText') >= 0) actualTextSeen = true;
      out.push(runContent(content, fonts));
    }
    let title = '';
    for (const [, o] of objects) {
      const m = o.body.match(/\/Title\s*(<[0-9a-fA-F\s]*>|\((?:\\.|[^\\)])*\))/);
      if (m) { title = decodeTextString(m[1][0] === '<' ? hexToBytes(m[1].slice(1, -1)) : literalToBytes(m[1].slice(1, -1))); break; }
    }
    return { pages: out, title, actualText: actualTextSeen };
  }

  const api = { extract };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfExtract = api;
})(typeof window !== 'undefined' ? window : globalThis);
