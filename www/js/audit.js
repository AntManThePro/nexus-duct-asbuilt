/* NEXUS — automated NFPA 96 compliance kernel */
(function (global) {
  'use strict';
  const N = global.NEXUS;
  const { STATE, $, fmtFt } = N;

  const CLASS_RANK = { light: 0, medium: 1, heavy: 2, 'extra-heavy': 3 };
  const CADENCE = {
    solid: 'MONTHLY — solid fuel cooking (Table 12.4)',
    high: 'QUARTERLY — high-volume / charbroil / wok (Table 12.4)',
    moderate: 'SEMIANNUALLY — moderate-volume cooking (Table 12.4)',
    low: 'ANNUALLY — low-volume cooking (Table 12.4)'
  };

  function rule(id, ref, title, status, desc) { return { id, ref, title, status, desc }; }

  function runComplianceAudit(project) {
    const p = project || STATE.project;
    const ns = p.nodes;
    const site = p.site;
    const rules = [];
    const violations = [];
    const spanLimit = Number(site.spanRule) || 12;

    // 1. Horizontal access spacing
    const badHorz = ns.filter(n => n.type === 'horizontal' && Number(n.length) > spanLimit && !n.hasDoor);
    // also: consecutive horizontal footage without any door between doors
    let runSince = 0, spacingBreach = null;
    ns.forEach(n => {
      if (n.type === 'horizontal' || n.type === 'elbow45') {
        runSince += Number(n.length) || 0;
        if (runSince > spanLimit && !spacingBreach) spacingBreach = n;
      }
      if (n.hasDoor || n.type === 'vertical' || n.type === 'cleanout') runSince = 0;
    });
    if (badHorz.length) {
      rules.push(rule('horz', `NFPA 96 §7.4.1.2 / ${spanLimit === 20 ? 'IMC 506.3.9' : 'cleaning intervals'}`, 'HORIZ. ACCESS SPACING', 'fail',
        `VIOLATION: Node #${badHorz[0].id} spans ${fmtFt(Number(badHorz[0].length))} without a listed access opening (max ${spanLimit} ft).`));
      violations.push(`Horizontal segment #${badHorz[0].id} exceeds ${spanLimit} ft without access door.`);
    } else if (spacingBreach) {
      rules.push(rule('horz', 'NFPA 96 §7.4.1.2', 'HORIZ. ACCESS SPACING', 'warn',
        `WARNING: Cumulative horizontal footage reaches node #${spacingBreach.id} with >${spanLimit} ft between access openings.`));
      violations.push(`Cumulative horizontal run exceeds ${spanLimit} ft between access openings near node #${spacingBreach.id}.`);
    } else {
      rules.push(rule('horz', 'NFPA 96 §7.4.1.2', 'HORIZ. ACCESS SPACING', 'pass', `All horizontal runs satisfy the ${spanLimit}-foot maximum access opening interval.`));
    }

    // 2. Access at changes of direction
    const badBends = ns.filter(n => (n.type === 'elbow90' || n.type === 'elbow45') && !n.hasDoor);
    if (badBends.length) {
      rules.push(rule('bends', 'NFPA 96 §7.4.1.1', 'ACCESS AT DIRECTION CHANGE', 'fail',
        `DEFICIT: ${badBends.length} change(s) of direction without an access opening (first: #${badBends[0].id}). Grease pooling risk.`));
      violations.push(`${badBends.length} direction change(s) lack access openings (first #${badBends[0].id}).`);
    } else {
      rules.push(rule('bends', 'NFPA 96 §7.4.1.1', 'ACCESS AT DIRECTION CHANGE', 'pass', 'Access openings present at every change of direction.'));
    }

    // 3. Vertical risers
    const tall = ns.filter(n => n.type === 'vertical' && Number(n.length) > 12 && !n.hasDoor);
    const hasRiser = ns.some(n => n.type === 'vertical');
    if (tall.length) {
      rules.push(rule('risers', 'NFPA 96 §7.4.3', 'VERTICAL RISER ACCESS', 'warn',
        `WARNING: Riser #${tall[0].id} is ${fmtFt(Number(tall[0].length))} tall with no intermediate / top access opening (floor-penetration & top-of-riser access expected).`));
      violations.push(`Vertical riser #${tall[0].id} exceeds 12 ft without access.`);
    } else {
      rules.push(rule('risers', 'NFPA 96 §7.4.3', 'VERTICAL RISER ACCESS', 'pass', hasRiser ? 'Vertical stacks conform to riser access criteria.' : 'No vertical risers recorded.'));
    }

    // 4. Fan
    if (site.fanType === 'upblast_unhinged') {
      rules.push(rule('fan', 'NFPA 96 §7.8.2.1', 'FAN HINGE INTEGRITY', 'fail', 'CRITICAL: Upblast fans require an approved hinge kit and hold-open retainer for cleaning and inspection.'));
      violations.push('Rooftop upblast fan is non-hinged.');
    } else if (site.fanType === 'inline_blower') {
      const inlineDoors = ns.filter(n => n.hasDoor && n.type !== 'hood' && n.type !== 'fan').length;
      const ok = inlineDoors >= 2;
      rules.push(rule('fan', 'NFPA 96 §7.8.3', 'IN-LINE FAN ACCESS', ok ? 'pass' : 'warn', ok ? 'In-line fan has access on both sides of the fan housing.' : 'WARNING: In-line fans require access openings on both inlet and discharge sides for cleaning.'));
      if (!ok) violations.push('In-line blower lacks dual access openings.');
    } else if (site.fanType === 'sidewall') {
      rules.push(rule('fan', 'NFPA 96 §7.8.3', 'SIDEWALL DISCHARGE', 'warn', 'WARNING: Verify 10 ft clearance from property line/openings and 3 ft above adjacent grade; outlet must not discharge onto walkways.'));
      violations.push('Sidewall discharge clearances require field verification.');
    } else {
      rules.push(rule('fan', 'NFPA 96 §7.8.2.1', 'FAN HINGE INTEGRITY', 'pass', 'Upblast fan matches hinged base with hold-open retainer requirement.'));
    }

    // 5. Hood envelope vs appliance line
    const applW = p.appliances.reduce((a, x) => a + (Number(x.width) || 0), 0);
    const heaviest = p.appliances.reduce((m, x) => Math.max(m, CLASS_RANK[x.cls] ?? 1), -1);
    const declared = CLASS_RANK[site.duty] ?? 1;
    if (applW > p.hood.length) {
      rules.push(rule('hood', 'NFPA 96 §5.1 / IMC 507.13', 'HOOD COVERAGE', 'fail', `VIOLATION: Appliance line ${fmtFt(applW)} exceeds hood length ${fmtFt(p.hood.length)}; canopy must overhang the cooking surface.`));
      violations.push(`Appliance line (${fmtFt(applW)}) exceeds hood length (${fmtFt(p.hood.length)}).`);
    } else if (p.appliances.length && applW > p.hood.length - 1) {
      rules.push(rule('hood', 'NFPA 96 §5.1 / IMC 507.13', 'HOOD COVERAGE', 'warn', `WARNING: Less than 6 in end overhang per side (${fmtFt(p.hood.length - applW)} total spare). Verify canopy overhang.`));
      violations.push('Hood end overhang marginal.');
    } else {
      rules.push(rule('hood', 'NFPA 96 §5.1', 'HOOD COVERAGE', 'pass', p.appliances.length ? `Canopy ${fmtFt(p.hood.length)} covers ${fmtFt(applW)} appliance line with overhang.` : 'No appliances recorded yet.'));
    }

    // 6. Declared duty vs appliance classes
    if (heaviest > declared) {
      const name = p.appliances.find(x => (CLASS_RANK[x.cls] ?? 1) === heaviest).name;
      rules.push(rule('duty', 'NFPA 96 §4.1 / Table 12.4', 'DUTY CLASSIFICATION', 'fail', `VIOLATION: "${name}" is ${Object.keys(CLASS_RANK)[heaviest].replace('-', ' ')} duty but the system is declared ${site.duty.replace('-', ' ')} duty. Filters, hood listing & cleaning cadence must match the heaviest appliance.`));
      violations.push(`Declared duty (${site.duty}) is below heaviest appliance class.`);
    } else if (heaviest === 3 && site.volume !== 'solid') {
      rules.push(rule('duty', 'NFPA 96 Ch. 14', 'SOLID FUEL', 'warn', 'WARNING: Solid-fuel appliance present — monthly inspection cadence, spark arrestor and separate exhaust system (Ch. 14) apply.'));
      violations.push('Solid fuel appliance without solid-fuel inspection cadence.');
    } else {
      rules.push(rule('duty', 'NFPA 96 §4.1', 'DUTY CLASSIFICATION', 'pass', 'Declared duty level covers every appliance under the canopy.'));
    }

    // 7. Collars (field practice)
    const perCollar = p.hood.length / Math.max(1, p.hood.collars);
    if (perCollar > 12) {
      rules.push(rule('collars', 'FIELD PRACTICE / MFR LISTING', 'DUCT COLLARS', 'warn', `WARNING: ${fmtFt(p.hood.length)} hood served by ${p.hood.collars} collar (${fmtFt(perCollar)} per collar). Verify listed hood capture velocity; consider an additional collar.`));
      violations.push('Collar count may be insufficient for hood length.');
    } else {
      rules.push(rule('collars', 'MFR LISTING', 'DUCT COLLARS', 'pass', `${p.hood.collars} collar(s) for ${fmtFt(p.hood.length)} canopy (${fmtFt(perCollar)} per collar).`));
    }

    // 8. Run integrity
    const hasFan = ns.some(n => n.type === 'fan');
    const ductPieces = ns.filter(n => n.type !== 'hood' && n.type !== 'fan').length;
    if (!hasFan || ductPieces === 0) {
      rules.push(rule('run', 'NFPA 96 §7.1', 'RUN INTEGRITY', 'fail', 'VIOLATION: Run must terminate at an exhaust fan and contain at least one duct section.'));
      violations.push('Incomplete run (missing fan or duct sections).');
    } else {
      rules.push(rule('run', 'NFPA 96 §7.1', 'RUN INTEGRITY', 'pass', `Continuous run hood → fan, ${ductPieces} duct component(s), ${N.totalRunFeet(ns)} ft total.`));
    }

    // §4.6 packet flags
    const k = p.packet;
    const flags = [
      { t: 'Exhaust system drawing(s) on premises', ok: !!k.drawings, ref: '§4.6.1', d: 'A drawing of the exhaust system installation shall be kept on the premises.' },
      { t: 'Operating instructions for subassemblies', ok: !!k.instructions, ref: '§4.6.1', d: 'Copies of operating instructions for sub-assemblies and components.' },
      { t: 'Electrical schematics', ok: !!k.electrical, ref: '§4.6.1', d: 'Electrical schematics for fans, controls and suppression interlocks.' },
      { t: 'Component / fitting schedule', ok: !!k.components, ref: '§4.6.4', d: 'All components identified on the as-built (this packet auto-generates the schedule).' },
      { t: 'Cleaning & inspection records', ok: !!k.cleaning, ref: '§12.6.13', d: 'Records of inspection and cleaning available to the AHJ.', warn: true },
      { t: 'Hood dimensions recorded', ok: p.hood.length > 0, ref: '§4.6.4', d: `${fmtFt(p.hood.length)} × ${fmtFt(p.hood.depth)} ${p.hood.type}` },
      { t: 'Appliance line recorded', ok: p.appliances.length > 0, ref: '§4.6.4', d: `${p.appliances.length} appliance(s) under canopy`, warn: true },
      { t: 'Geometry: hood → duct → fan', ok: hasFan && ductPieces > 0, ref: '§4.6.4', d: `${ns.length} nodes mapped` },
      { t: 'Permit as-built gap', ok: !site.permitGap, ref: 'AHJ', d: site.permitGap ? 'Existing unrecorded run flagged — this packet documents the gap for AHJ review.' : 'No permit gap flagged.', warn: true }
    ].map(f => ({ ...f, status: f.ok ? 'pass' : (f.warn ? 'warn' : 'fail') }));

    flags.filter(f => f.status === 'fail').forEach(f => violations.push(`Packet: ${f.t} missing.`));

    // Score
    let score = 100;
    rules.forEach(r => { if (r.status === 'fail') score -= 15; else if (r.status === 'warn') score -= 6; });
    flags.forEach(f => { if (f.status === 'fail') score -= 5; else if (f.status === 'warn') score -= 2; });
    score = Math.max(0, Math.round(score));

    const result = { rules, flags, violations, score, cadence: CADENCE[site.volume] || CADENCE.moderate };
    if (!project || project === STATE.project) { STATE.audit = result; renderAudit(); }
    return result;
  }

  function renderAudit() {
    const a = STATE.audit;
    const grid = $('auditGrid');
    if (!grid) return;
    grid.innerHTML = a.rules.map(r => `
      <div class="rule ${r.status}">
        <div class="ref">${r.ref}</div>
        <div class="title"><span>${r.title}</span><span class="badge ${r.status}">${r.status === 'pass' ? 'PASS' : r.status === 'warn' ? 'WARNING' : 'VIOLATION'}</span></div>
        <div class="desc">${r.desc}</div>
      </div>`).join('');

    $('packetFlags').innerHTML = a.flags.map(flagHTML).join('');

    const badge = $('complianceOverallBadge');
    const fails = a.rules.filter(r => r.status === 'fail').length + a.flags.filter(f => f.status === 'fail').length;
    if (a.violations.length === 0) { badge.className = 'chip green'; badge.textContent = '100% COMPLIANT'; }
    else if (fails === 0) { badge.className = 'chip amber'; badge.textContent = `${a.violations.length} WARNING(S)`; }
    else { badge.className = 'chip hazard'; badge.textContent = `${a.violations.length} HAZARD(S) FLAGGED`; }

    $('scoreVal').textContent = `${a.score}%`;
    const arc = $('scoreArc');
    const circ = 2 * Math.PI * 34;
    arc.setAttribute('stroke-dashoffset', String(circ * (1 - a.score / 100)));
    arc.setAttribute('stroke', a.score >= 90 ? '#00e676' : a.score >= 70 ? '#ffb300' : '#ff3d00');
    $('cadenceLabel').textContent = a.cadence;
    $('chipSpan').textContent = `${STATE.project.site.spanRule} FT`;
    $('recordIdChip').textContent = N.recordId();
    $('runHashLabel').textContent = N.projectHash();
  }

  function flagHTML(f) {
    const ic = f.status === 'pass' ? '✓' : f.status === 'warn' ? '▲' : '✕';
    return `<div class="flag ${f.status}"><span class="ic ${f.status === 'pass' ? 'green' : f.status === 'warn' ? 'amber' : 'hazard'}">${ic}</span><div><div class="t">${f.t} <span class="dim">· ${f.ref}</span></div><div class="d">${f.d}</div></div></div>`;
  }

  N.audit = { runComplianceAudit, renderAudit, flagHTML, CADENCE, CLASS_RANK };
})(window);
