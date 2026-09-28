// Preloaded into firebase-tools by rules/run.mjs (node -r). universal-analytics (a firebase-tools
// dependency) may resolve to uuid 14, which is ESM-only and can't be require()d on Node < 20.19
// (ERR_REQUIRE_ESM). Point that one require at a CommonJS uuid that is also installed.
const Module = require('module');
const path = require('path');
const orig = Module._resolveFilename;
let fallback = null;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'uuid' && parent && /universal-analytics/.test(parent.filename || '')) {
    try {
      const resolved = orig.call(this, request, parent, ...rest);
      require(resolved);            // works on this Node: keep it
      return resolved;
    } catch (e) {
      if (e.code !== 'ERR_REQUIRE_ESM') throw e;
      if (!fallback) fallback = orig.call(this, 'uuid', { id: __filename, filename: __filename, paths: Module._nodeModulePaths(path.resolve(__dirname, '..')) });
      return fallback;
    }
  }
  return orig.call(this, request, parent, ...rest);
};
