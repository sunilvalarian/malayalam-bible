/*
 * Photo / scan → Malayalam text, in the browser (Tesseract.js, loaded only when first used).
 *
 * The library, its WebAssembly core and the Malayalam language data (~ a few MB) come from
 * jsdelivr the first time someone scans; the service worker keeps the scripts and Tesseract
 * keeps the language data in IndexedDB, so later scans also work offline.
 *
 * Ocr.recognize(files, onProgress) → { pages: [[line, ...], ...] }   (same shape as PdfExtract,
 * so BibleParser.parsePdfParagraphs can turn it into chapters; it joins the hard-wrapped lines).
 */
(function (root) {
  'use strict';

  // keep the version in step with TESSERACT in sw.js
  const LIB = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
  const MAX_SIDE = 2600;   // phone photos are 4000px+; this is plenty for print and saves memory

  let libPromise = null;
  function loadLib() {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    libPromise = libPromise || new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = LIB;
      s.crossOrigin = 'anonymous';
      s.onload = () => (root.Tesseract ? res(root.Tesseract) : rej(new Error('OCR load failed')));
      s.onerror = () => { libPromise = null; rej(new Error('OCR ലൈബ്രറി ലോഡ് ചെയ്യാനായില്ല — ആദ്യ സ്കാനിന് ഇന്റർനെറ്റ് വേണം')); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  // photo → grey, downscaled canvas (upright: the browser applies the EXIF rotation)
  async function prepare(file) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { src = null; }
    if (!src) {
      src = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error('ചിത്രം തുറക്കാനായില്ല'));
        img.src = URL.createObjectURL(file);
      });
    }
    const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
    const k = Math.min(1, MAX_SIDE / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.filter = 'grayscale(1) contrast(1.25)';
    g.drawImage(src, 0, 0, c.width, c.height);
    if (src.close) src.close(); else URL.revokeObjectURL(src.src);
    return c;
  }

  // Tesseract's plain-text output: blocks / paragraphs are separated by blank lines
  function toLines(text) {
    return String(text || '')
      .replace(/[൦-൯]/g, (d) => String(d.charCodeAt(0) - 0x0D66))   // Malayalam digits → 0-9
      .replace(/[|¦]/g, ' ')
      .replace(/്\u200C(?![ഀ-ൿ])/g, '്')   // Tesseract writes a visible virama as ് + ZWNJ; the Bible text has none
      .split(/\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l) => l && /[ഀ-ൿ\d]/.test(l));
  }

  let worker = null;
  let progressCb = null;
  async function getWorker() {
    if (worker) return worker;
    const T = await loadLib();
    worker = T.createWorker('mal', 1, {
      logger: (m) => progressCb && progressCb(m),
      errorHandler: (e) => console.warn('ocr:', e),
    }).catch((e) => { worker = null; throw e; });
    return worker;
  }

  /**
   * files: image Files / Blobs (one per page, in reading order)
   * onProgress({ page, pages, stage: 'load' | 'read', p: 0..1 })
   */
  async function recognize(files, onProgress) {
    const report = onProgress || (() => {});
    const total = files.length;
    let page = 0;
    progressCb = (m) => {
      const stage = m.status === 'recognizing text' ? 'read' : 'load';
      report({ page: page + 1, pages: total, stage, p: m.progress || 0 });
    };
    report({ page: 1, pages: total, stage: 'load', p: 0 });
    const w = await getWorker();
    const pages = [];
    for (page = 0; page < total; page++) {
      const canvas = await prepare(files[page]);
      const { data } = await w.recognize(canvas);
      pages.push(toLines(data.text));
      canvas.width = canvas.height = 0;
    }
    progressCb = null;
    return { pages };
  }

  // free the worker's memory (the Malayalam model is large) once the dialog is closed
  async function release() {
    const w = worker;
    worker = null;
    if (w) { try { await (await w).terminate(); } catch (e) { /* already gone */ } }
  }

  root.Ocr = { recognize, release, toLines, LIB };
})(typeof window !== 'undefined' ? window : globalThis);
