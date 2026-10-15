// node check.cjs GEN_1.json GEN_2.json ...  — validates translated chapter files
const fs = require('fs');
const path = require('path');
// verses per chapter (Genesis: English numbering, but 31 and 32 as in the Hebrew / the app)
const COUNTS = {
  GEN: [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,54,33,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26],
  MAT: [25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20],
  MRK: [45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20],
  // the rest of the New Testament (English / RSV-CE numbering)
  LUK: [80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53],
  JHN: [51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25],
  ACT: [26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31],
  ROM: [32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27],
  '1CO': [31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24],
  '2CO': [24,17,18,18,21,18,16,24,15,18,33,21,14],
  GAL: [24,21,29,31,26,18],
  EPH: [23,22,21,32,33,24],
  PHP: [30,30,21,23],
  COL: [29,23,25,18],
  '1TH': [10,20,13,18,28],
  '2TH': [12,17,18],
  '1TI': [20,15,16,16,25,21],
  '2TI': [18,26,17,22],
  TIT: [16,15,15],
  PHM: [25],
  HEB: [14,18,19,16,14,20,28,13,28,39,40,29,25],
  JAS: [27,26,18,17,20],
  '1PE': [25,25,22,19,14],
  '2PE': [21,22,18],
  '1JN': [10,29,24,21,21],
  '2JN': [13],
  '3JN': [15],
  JUD: [25],
  REV: [20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21],
};
let bad = 0;
for (const arg of process.argv.slice(2)) {
  const file = path.isAbsolute(arg) ? arg : path.join(__dirname, arg);
  const problems = [];
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { problems.push('not valid JSON: ' + e.message); }
  if (d) {
    const counts = COUNTS[d.book];
    const n = counts && counts[d.chapter - 1];
    if (!counts) problems.push('book must be one of ' + Object.keys(COUNTS).join(', '));
    else if (!n) problems.push('bad chapter ' + d.chapter);
    else if (path.basename(file) !== `${d.book}_${d.chapter}.json`) problems.push(`file name must be ${d.book}_${d.chapter}.json`);
    const vs = Array.isArray(d.verses) ? d.verses : [];
    if (n && vs.length !== n) problems.push(`has ${vs.length} verses, chapter ${d.chapter} needs ${n}`);
    vs.forEach((x, i) => {
      if (x.v !== i + 1) problems.push(`entry ${i + 1} has v=${x.v}`);
      if (typeof x.text !== 'string' || !x.text.trim()) problems.push(`v${x.v}: empty text`);
      else if (!/[ഀ-ൿ]/.test(x.text)) problems.push(`v${x.v}: no Malayalam`);
      else if (/[A-Za-z]{3,}/.test(x.text)) problems.push(`v${x.v}: Latin letters in text`);
      if (typeof x.heading !== 'string') problems.push(`v${x.v}: heading must be a string ("" for none)`);
      else if (x.heading.length > 80) problems.push(`v${x.v}: heading too long`);
      const keys = Object.keys(x).sort().join(',');
      if (keys !== 'heading,text,v') problems.push(`v${x.v}: keys must be v, heading, text`);
    });
    const heads = vs.filter((x) => x.heading).length;
    if (vs.length && heads > Math.max(5, Math.ceil(vs.length / 6))) problems.push(`${heads} headings — too many, use them sparingly`);
  }
  if (problems.length) { bad++; console.log(path.basename(file) + ': ' + problems.slice(0, 15).join('; ')); }
  else console.log(path.basename(file) + ': OK (' + d.verses.length + ' verses)');
}
process.exit(bad ? 1 : 0);
