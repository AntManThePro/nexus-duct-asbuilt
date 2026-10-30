const test = require('node:test');
const assert = require('node:assert/strict');
const { loadNexus } = require('./load');
const NEXUS = loadNexus();

function project(nodes, extra = {}) {
  const p = NEXUS.defaultProject();
  p.nodes = nodes.map((n, i) => ({ id: i + 1, hasDoor: false, dir: 'right', length: 0, ...n }));
  Object.assign(p.site, extra.site || {});
  if (extra.appliances) p.appliances = extra.appliances;
  return p;
}

test('long horizontal without door fails 12 ft rule', () => {
  const p = project([{ type: 'hood' }, { type: 'vertical', length: 8, dir: 'up' }, { type: 'elbow90' }, { type: 'horizontal', length: 24 }, { type: 'fan' }], { site: { spanRule: 12 } });
  const a = NEXUS.audit.runComplianceAudit(p);
  assert.ok(a.rules.some((r) => r.status === 'fail'), 'expected at least one fail');
  assert.ok(a.score < 100);
});

test('compliant run scores high', () => {
  const p = project([{ type: 'hood' }, { type: 'vertical', length: 8, dir: 'up' }, { type: 'elbow90', hasDoor: true }, { type: 'horizontal', length: 10, hasDoor: true }, { type: 'fan' }], { site: { spanRule: 12, fanType: 'upblast_hinged' } });
  const a = NEXUS.audit.runComplianceAudit(p);
  assert.ok(!a.rules.some((r) => r.status === 'fail'), JSON.stringify(a.rules.filter((r) => r.status === 'fail')));
});

test('non-hinged fan is a failure', () => {
  const p = project([{ type: 'hood' }, { type: 'vertical', length: 8, dir: 'up' }, { type: 'fan' }], { site: { fanType: 'upblast_unhinged' } });
  const a = NEXUS.audit.runComplianceAudit(p);
  assert.ok(a.rules.some((r) => r.status === 'fail' && /fan|hinge/i.test(r.title + r.desc)));
});
