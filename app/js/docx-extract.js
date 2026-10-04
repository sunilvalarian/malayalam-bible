/*
 * Word (.docx) → paragraphs, for the upload dialog (same shape as PdfExtract: { pages: [[...]], title }).
 *
 * A .docx is a zip file; the text is in word/document.xml. This reads the zip's central directory,
 * inflates that one entry with DecompressionStream (no libraries) and collects the paragraphs:
 *   - each <w:p> → one paragraph; <w:t> text runs are joined, <w:tab/> → a space
 *   - a line break inside a paragraph (<w:br/>, <w:cr/>, Shift+Enter) starts a new line, so verses
 *     typed one per line come out one per line; page / column breaks are ignored
 *   - deleted text of tracked changes (<w:delText>) is left out, inserted text is kept
 * The whole document is one "page": Word paragraphs are complete, nothing is wrapped.
 * Old binary .doc files (Word 97–2003) are not zip files and are refused with a clear error.
 *
 * Works in the browser and in Node 18+.
 */
(function (root) {
  'use strict';

  const utf8 = new TextDecoder('utf-8');
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  function fail(code, message) { return Object.assign(new Error(message), { code }); }

  // zip central directory → Map(name → { method, offset, size })
  function readZip(bytes) {
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw fail('docx/not-zip', 'Not a .docx file');
    const count = u16(bytes, eocd + 10);
    let p = u32(bytes, eocd + 16);
    const entries = new Map();
    for (let n = 0; n < count && p + 46 <= bytes.length; n++) {
      if (u32(bytes, p) !== 0x02014b50) break;
      const method = u16(bytes, p + 10);
      const crc = u32(bytes, p + 16);
      const size = u32(bytes, p + 20);
      const usize = u32(bytes, p + 24);
      const nameLen = u16(bytes, p + 28), extraLen = u16(bytes, p + 30), commentLen = u16(bytes, p + 32);
      const local = u32(bytes, p + 42);
      const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      entries.set(name, { method, local, size, crc, usize });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function entryBytes(bytes, e) {
    if (u32(bytes, e.local) !== 0x04034b50) throw fail('docx/bad-zip', 'Damaged .docx file');
    const start = e.local + 30 + u16(bytes, e.local + 26) + u16(bytes, e.local + 28);
    const data = bytes.subarray(start, start + e.size);
    if (e.method === 0) return data;
    if (e.method !== 8) throw fail('docx/bad-zip', 'Unsupported compression in .docx file');
    // the entry is raw deflate; wrapped in a gzip header + trailer (CRC and size come from the zip
    // directory) it inflates with 'gzip', which every DecompressionStream supports ('deflate-raw' is
    // missing in older browsers and Node < 20.12)
    const head = new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff]);
    const tail = new Uint8Array(8);
    new DataView(tail.buffer).setUint32(0, e.crc, true);
    new DataView(tail.buffer).setUint32(4, e.usize, true);
    const stream = new Blob([head, data, tail]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] !== '#') return ENT[e.toLowerCase()];
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
  });

  // word/document.xml → [line, ...]
  function paragraphs(xml) {
    const out = [];
    let cur = '', inPara = false;
    const flush = () => { const t = cur.replace(/\s+/g, ' ').trim(); if (t) out.push(t); cur = ''; };
    // the tags that matter, in document order
    const re = /<w:p[\s>/]|<\/w:p>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(\s[^>]*)?\/>/g;
    let m;
    while ((m = re.exec(xml))) {
      const tag = m[0];
      if (tag.startsWith('<w:p')) {
        if (inPara) flush();      // a paragraph nested in a text box: keep the outer one's text apart
        inPara = !tag.endsWith('/');   // <w:p/> is an empty paragraph
      } else if (tag === '</w:p>') { flush(); inPara = false; }
      else if (tag.startsWith('<w:tab')) cur += ' ';
      else if (tag.startsWith('<w:br') || tag.startsWith('<w:cr')) {
        // a page / column break is layout, not a new line of text
        if (!/w:type="(page|column)"/.test(m[2] || '')) flush();
      } else cur += unescape(m[1]);
    }
    flush();
    return out;
  }

  async function extract(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    // Word 97–2003 .doc: an OLE compound file (D0 CF 11 E0), not a zip
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
      throw fail('docx/old-doc', 'Old .doc file');
    }
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw fail('docx/not-zip', 'Not a .docx file');
    const zip = readZip(bytes);
    const doc = zip.get('word/document.xml');
    if (!doc) throw fail('docx/not-word', 'No Word document inside');
    const xml = utf8.decode(await entryBytes(bytes, doc));
    let title = '';
    const core = zip.get('docProps/core.xml');
    if (core) {
      const m = utf8.decode(await entryBytes(bytes, core)).match(/<dc:title>([\s\S]*?)<\/dc:title>/);
      if (m) title = unescape(m[1]).trim();
    }
    return { pages: [paragraphs(xml)], title };
  }

  const api = { extract, paragraphs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DocxExtract = api;
})(typeof window !== 'undefined' ? window : globalThis);
