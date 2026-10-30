/* NEXUS — "Words Draw the Map" offline fuzzy trade-slang parser */
(function (global) {
  'use strict';
  const { nodeLabel } = global.NEXUS;

  const TRADE_DICTIONARY = {
    up: ['up', 'riser', 'rise', 'vert', 'vertical', 'climb', 'stack', 'straight up', 'going up', 'risr', 'vrtical', 'upward', 'rises'],
    down: ['down', 'drop', 'drops', 'downward', 'fall', 'descend'],
    right: ['right', 'east', 'rightward', 'towards wall', 'out'],
    left: ['left', 'west', 'leftward', 'back'],
    slant: ['slant', 'angle', 'offset', 'kick', 'slanted', 'incline', 'slnt', 'off-set', 'jog', 'dogleg45'],
    hood: ['hood', 'canopy', 'collar', 'plenum', 'range hood', 'exhaust hood', 'hod', 'start hood'],
    elbow90: ['elbow', '90', 'ninety', '90 elbow', 'hard 90', 'square turn', 'dogleg', 'hard turn', 'right angle', 'elbo', '90deg', '90-degree', '90 bend', 'turn', 'trun', 'bend', 'ell'],
    elbow45: ['45', 'fortyfive', '45 elbow', '45 deg', '45-degree', '45 bend', 'forty five'],
    horizontal: ['horizontal', 'horz', 'run', 'straight', 'flat', 'ceiling run', 'horiz', 'horzontal', 'horizontl', 'across', 'over', 'lateral'],
    cleanout: ['cleanout', 'clean-out', 'cleanouts'],
    fan: ['fan', 'upblast', 'exhaust fan', 'blower', 'roof fan', 'termination', 'discharge', 'upblast fan', 'hinged fan', 'unhinged fan', 'fn', 'rooftop', 'exhaust']
  };

  const WORD_NUMBERS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, half: 0.5
  };
  const DOOR_WORDS = ['door', 'doors', 'panel', 'panels', 'access', 'acces', 'accss', 'portal', 'hatch', 'opening'];
  const NEGATION = ['no', 'without', 'missing', 'none', 'lacking', 'w/o'];

  function levenshtein(a, b) {
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const m = [];
    for (let i = 0; i <= b.length; i++) m[i] = [i];
    for (let j = 0; j <= a.length; j++) m[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        m[i][j] = b[i - 1] === a[j - 1] ? m[i - 1][j - 1] : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
      }
    }
    return m[b.length][a.length];
  }

  function classifyWord(raw) {
    const clean = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!clean) return null;
    // exact pass first so short tokens like "90" / "45" are deterministic
    for (const [type, syns] of Object.entries(TRADE_DICTIONARY)) {
      if (syns.includes(clean)) return type;
    }
    if (clean.length < 4 || /^\d+$/.test(clean)) return null;
    const tol = clean.length >= 7 ? 2 : 1;
    let best = null, bestD = Infinity;
    for (const [type, syns] of Object.entries(TRADE_DICTIONARY)) {
      for (const syn of syns) {
        const s = syn.replace(/[^a-z0-9]/g, '');
        if (s.length < 4) continue;
        const d = levenshtein(clean, s);
        if (d <= tol && d < bestD) { bestD = d; best = type; }
      }
    }
    return best;
  }

  function isDoorWord(t) {
    const c = t.replace(/[^a-z]/g, '');
    return DOOR_WORDS.some(w => c === w || (c.length >= 4 && levenshtein(c, w) <= 1));
  }

  /**
   * Parse free text into an ordered node list (hood → ... → fan).
   * Returns { nodes, tokens } where tokens are the recognized classifications for telemetry.
   */
  function parseNaturalLanguageDuctRun(text) {
    const raw = String(text || '').toLowerCase()
      .replace(/(\d)\s*(?:ft|feet|foot|')/g, '$1 ft')
      .replace(/(\d)\s*(?:in|inch|inches|")/g, '$1 in')
      .replace(/(\d)\s*(?:deg|degree|degrees|°)/g, '$1');
    const tokens = raw.split(/[\s,;.]+/).filter(Boolean);
    const nodes = [{ id: 1, type: 'hood', label: 'Hood Collar', length: 0, dir: 'up', hasDoor: true, note: '' }];
    const telemetry = [];
    let id = 2;
    let pendingLength = null;   // a length that hasn't been attached to a segment yet
    let pendingDir = null;      // a direction word waiting for a length
    let pendingDoor = false;    // "with access door" said before the segment
    let negate = false;         // "no door" modifier
    let heading = 'up';         // current travel direction
    const FILLER = new Set(['ft', 'in', 'to', 'then', 'and', 'into', 'the', 'a', 'an', 'with', 'of', 'for', 'at', 'on', 'from', 'start', 'go', 'goes', 'going', 'it', 'there', 'hinged', 'listed']);
    const isVert = d => d === 'up' || d === 'down';
    const last = () => nodes[nodes.length - 1];

    const pushNode = (type, dir, len, extra = {}) => {
      const n = { id: id++, type, dir, length: len, hasDoor: pendingDoor && !negate, note: '', ...extra };
      if (type === 'fan') n.hasDoor = true;
      n.label = nodeLabel(n);
      nodes.push(n);
      telemetry.push({ type, len, door: n.hasDoor });
      pendingLength = null; pendingDoor = false; negate = false; pendingDir = null;
      if (type !== 'cleanout') heading = dir;
      return n;
    };
    const pushSegment = (dir, len) => pushNode(isVert(dir) ? 'vertical' : 'horizontal', dir, len);
    const setLength = (v) => {
      const l = last();
      if (l._awaitLen) { l.length = v; l.label = nodeLabel(l); telemetry[telemetry.length - 1].len = v; delete l._awaitLen; return; }
      if (pendingDir) { pushSegment(pendingDir, v); return; }
      pendingLength = v;
    };
    const flushDangling = () => {
      if (pendingLength !== null) pushSegment(pendingDir || heading, pendingLength);
      else if (pendingDir && pendingDir !== heading && last().type !== 'elbow90') {
        // bare "then up" with no length → short default segment
        pushSegment(pendingDir, isVert(pendingDir) ? 6 : 10);
      }
      pendingDir = null;
    };

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const next = tokens[i + 1] || '';

      if (NEGATION.includes(t)) { negate = true; continue; }

      if (isDoorWord(t)) {
        if (i > 0 && isDoorWord(tokens[i - 1])) continue; // "access door" → one modifier
        if (negate) { if (nodes.length > 1) { last().hasDoor = false; telemetry.length && (telemetry[telemetry.length - 1].door = false); } negate = false; }
        else if (nodes.length > 1 && pendingLength === null && !pendingDir) { last().hasDoor = true; telemetry.length && (telemetry[telemetry.length - 1].door = true); }
        else pendingDoor = true;
        continue;
      }

      // numbers: "12", "12.5", "twenty", "twenty two", "6 in"
      const num = t.match(/^(\d+(?:\.\d+)?)$/);
      if (num) {
        let v = parseFloat(num[1]);
        const unitNext = next === 'in' || next === 'ft';
        if (next === 'in') { v = v / 12; i++; }
        else if (next === 'ft') { i++; }
        if (!unitNext && (v === 90 || v === 45)) { /* angle keyword — fall through to classification */ }
        else { setLength(v); continue; }
      } else if (WORD_NUMBERS[t] !== undefined) {
        let v = WORD_NUMBERS[t];
        if (v >= 20 && WORD_NUMBERS[next] !== undefined && WORD_NUMBERS[next] < 10) { v += WORD_NUMBERS[next]; i++; }
        if (tokens[i + 1] === 'ft') i++;
        setLength(v); continue;
      }
      if (FILLER.has(t)) continue;

      const cls = classifyWord(t);
      if (!cls) continue;

      if (cls === 'hood') continue;
      if (cls === 'cleanout') { flushDangling(); pushNode('cleanout', heading, 0, { hasDoor: true }); continue; }

      if (cls === 'right' || cls === 'left' || cls === 'up' || cls === 'down') {
        const l = last();
        if (l.type === 'elbow90' && l._awaitDir) {
          // "90 right" → retro-set the elbow's new heading
          l.dir = cls; l.label = nodeLabel(l); delete l._awaitDir; heading = cls;
          if (pendingLength !== null) pushSegment(cls, pendingLength); else pendingDir = cls;
          continue;
        }
        if (l.type === 'elbow45' && l._awaitLen) { l.dir = cls; l.label = nodeLabel(l); pendingDir = cls; heading = cls; continue; }
        if (pendingLength !== null) { pushSegment(cls, pendingLength); continue; }
        // "up ... right" with no length between: flush the previous dangling direction
        if (pendingDir && pendingDir !== cls) flushDangling();
        pendingDir = cls;
        continue;
      }
      if (cls === 'elbow90') {
        const l = last();
        if (l.type === 'elbow90' && l._awaitDir) continue; // "dogleg 90" → one fitting
        flushDangling();
        const newDir = isVert(heading) ? 'right' : 'up';
        const n = pushNode('elbow90', newDir, 1);
        n._awaitDir = true;
        continue;
      }
      if (cls === 'slant' || cls === 'elbow45') {
        if (cls === 'slant' && (next === '90' || next === 'ninety')) continue; // "kick 90" is a hard 90
        const l = last();
        if (l.type === 'elbow45' && l._awaitLen && pendingLength === null) continue; // "slant 45" → one fitting
        flushDangling();
        const n45 = pushNode('elbow45', isVert(heading) ? 'up' : heading, 4);
        n45._awaitLen = true; // "slant 45 up 6ft" → direction and length follow
        continue;
      }
      if (cls === 'horizontal') {
        const nextCls = classifyWord(next);
        if (nextCls === 'up' || nextCls === 'down') continue; // "straight up" is a riser, not a run
        const dir = pendingDir && !isVert(pendingDir) ? pendingDir : (heading === 'left' ? 'left' : 'right');
        if (pendingDir && isVert(pendingDir) && pendingLength === null) flushDangling();
        const n = pushNode('horizontal', dir, pendingLength !== null ? pendingLength : 10);
        if (n.length === 10 && pendingLength === null) n._awaitLen = true;
        continue;
      }
      if (cls === 'fan') {
        if (last().type === 'fan') continue;
        flushDangling();
        pushNode('fan', 'up', 3);
        continue;
      }
    }

    flushDangling();
    nodes.forEach(n => { delete n._awaitDir; delete n._awaitLen; });
    if (!nodes.some(n => n.type === 'fan')) pushNode('fan', 'up', 3);
    return { nodes, telemetry };
  }

  global.NEXUS.parser = { parseNaturalLanguageDuctRun, classifyWord, levenshtein, TRADE_DICTIONARY };
})(window);
