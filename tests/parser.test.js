const test = require('node:test');
const assert = require('node:assert/strict');
const { loadNexus } = require('./load');
const NEXUS = loadNexus();
const parse = (t) => NEXUS.parser.parseNaturalLanguageDuctRun(t).nodes;

test('standard run compiles hood → riser → elbow → horizontal → fan', () => {
  const n = parse('Hood collar up 8ft then dogleg 90 right horizontal 22ft with access panel then slant 45 up 6ft into hinged upblast fan');
  assert.equal(n[0].type, 'hood');
  assert.equal(n.at(-1).type, 'fan');
  const horiz = n.find((x) => x.type === 'horizontal');
  assert.ok(horiz, 'has horizontal');
  assert.equal(horiz.length, 22);
  assert.equal(horiz.hasDoor, true);
  assert.ok(n.some((x) => x.type === 'vertical' && x.length === 8));
  assert.ok(n.some((x) => x.type === 'elbow45'));
});

test('word numbers and typos are normalised', () => {
  const n = parse('hood risr twelve ft hard trun horzontal 24ft no accss door to fan');
  assert.ok(n.some((x) => x.type === 'vertical' && x.length === 12));
  const h = n.find((x) => x.type === 'horizontal');
  assert.equal(h.length, 24);
  assert.equal(h.hasDoor, false);
});

test('empty text yields at least hood and fan', () => {
  const n = parse('');
  assert.ok(n.length >= 2);
});
