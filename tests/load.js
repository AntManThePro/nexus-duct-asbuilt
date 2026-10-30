// Loads the browser modules into a minimal fake window so parser/audit can be unit-tested in Node.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function loadNexus() {
  const store = {};
  const window = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    navigator: { userAgent: 'node' }, document: { getElementById: () => null, addEventListener() {}, createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }) },
    addEventListener() {}, setTimeout, clearTimeout, console, Date, Math, JSON,
  };
  window.window = window; window.globalThis = window;
  const ctx = vm.createContext(window);
  for (const f of ['core.js', 'parser.js', 'audit.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'www', 'js', f), 'utf8'), ctx, { filename: f });
  }
  return window.NEXUS;
}
module.exports = { loadNexus };
