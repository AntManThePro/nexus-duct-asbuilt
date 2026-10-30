// Minimal syntax lint: node --check every JS file under www/ and tests/
const { execFileSync } = require('node:child_process');
const { readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');
function walk(d, out = []) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p, out) : /\.js$/.test(f) && out.push(p); } return out; }
let failed = 0;
for (const f of [...walk('www'), ...walk('tests'), ...walk('scripts')]) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); console.log('ok  ', f); }
  catch (e) { failed++; console.error('FAIL', f, '\n', e.stderr.toString()); }
}
process.exit(failed ? 1 : 0);
