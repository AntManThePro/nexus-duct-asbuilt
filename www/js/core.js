/* NEXUS Duct As-Built — core state, utilities, persistence, audio, toast */
(function (global) {
  'use strict';

  const SCALE = 14; // world px per foot
  const STORAGE_KEY = 'nexus.project.v1';
  const APP_VERSION = '5.0.0';

  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmtFt = (v) => (Number.isInteger(v) ? `${v}'` : `${v.toFixed(1)}'`);

  function defaultProject() {
    return {
      version: APP_VERSION,
      site: {
        name: 'Smokestack BBQ - Pit 03',
        ahj: 'Austin FD Prevention / Travis Co.',
        technician: 'DoubleA · AntManThePro',
        date: new Date().toISOString().slice(0, 10),
        duty: 'medium',
        fanType: 'upblast_hinged',
        spanRule: 12,
        volume: 'moderate',
        permitGap: true
      },
      hood: { type: 'wall', length: 10, depth: 4, collars: 1 },
      appliances: [
        { name: '40 lb Fryer', cls: 'medium', width: 1.5 },
        { name: '36in Griddle', cls: 'medium', width: 3 },
        { name: '6-Burner Range', cls: 'medium', width: 3 }
      ],
      packet: { drawings: true, instructions: false, electrical: false, components: true, cleaning: false },
      nodes: [
        { id: 1, type: 'hood', label: 'Hood Collar', length: 0, dir: 'up', hasDoor: true, note: '' },
        { id: 2, type: 'vertical', label: 'Vertical Riser', length: 8, dir: 'up', hasDoor: false, note: '' },
        { id: 3, type: 'elbow90', label: '90° Elbow', length: 1, dir: 'right', hasDoor: true, note: '' },
        { id: 4, type: 'horizontal', label: 'Horizontal Duct', length: 22, dir: 'right', hasDoor: false, note: '' },
        { id: 5, type: 'elbow90', label: '90° Elbow', length: 1, dir: 'up', hasDoor: false, note: '' },
        { id: 6, type: 'vertical', label: 'Vertical Riser', length: 6, dir: 'up', hasDoor: false, note: '' },
        { id: 7, type: 'fan', label: 'Rooftop Upblast Fan', length: 3, dir: 'up', hasDoor: true, note: '' }
      ],
      strokes: [],
      slangText: ''
    };
  }

  const STATE = {
    project: defaultProject(),
    viewMode: 'wizard',
    currentStep: 1,
    audioEnabled: true,
    canvasMode: 'cad',
    drawColor: '#ff3d00',
    drawWidth: 4,
    selectedNodeIndex: null,
    audit: { rules: [], flags: [], violations: [], score: 100, cadence: '' },
    view: { zoom: 1, panX: 0, panY: 0 }
  };

  // ---------- Persistence ----------
  let saveTimer = null;
  function saveProject() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE.project)); } catch (e) { /* quota / private mode */ }
    }, 250);
  }
  function loadProject() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.nodes)) return false;
      STATE.project = Object.assign(defaultProject(), data);
      STATE.project.site = Object.assign(defaultProject().site, data.site || {});
      STATE.project.hood = Object.assign(defaultProject().hood, data.hood || {});
      STATE.project.packet = Object.assign(defaultProject().packet, data.packet || {});
      return true;
    } catch (e) { return false; }
  }

  // ---------- Hash / record id ----------
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  function projectHash() {
    const p = STATE.project;
    return fnv1a(JSON.stringify({ s: p.site, h: p.hood, a: p.appliances, n: p.nodes, k: p.packet }));
  }
  function recordId() {
    const y = (STATE.project.site.date || '').slice(0, 4) || new Date().getFullYear();
    return `NX-${y}-${projectHash().slice(0, 4).toUpperCase()}`;
  }

  // ---------- Audio (Web Audio, lazy) ----------
  let audioCtx = null;
  let userGestured = false;
  if (typeof document !== 'undefined') {
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { userGestured = true; }, { once: true, passive: true }));
  }
  function playBeep(freq = 600, type = 'sine', duration = 0.08) {
    if (!STATE.audioEnabled || !userGestured) return; // browsers block audio before a gesture
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + duration);
    } catch (e) { /* audio unavailable */ }
  }
  function haptic(style) {
    const H = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Haptics;
    if (H) { H.impact({ style: style || 'LIGHT' }).catch(() => {}); return; }
    if (navigator.vibrate) navigator.vibrate(style === 'HEAVY' ? 30 : 10);
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(message, type = 'info') {
    const box = $('toastBox');
    $('toastMsg').textContent = message;
    $('toastIcon').textContent = type === 'error' ? '⚠' : type === 'warn' ? '▲' : '✓';
    box.className = `toast show ${type === 'info' ? '' : type}`;
    if (type === 'error') playBeep(320, 'square', 0.2);
    else if (type === 'warn') playBeep(450, 'sawtooth', 0.12);
    else playBeep(880, 'sine', 0.09);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('show'), 3000);
  }

  // ---------- Node geometry / layout ----------
  const DIR_VEC = { up: [0, -1], down: [0, 1], right: [1, 0], left: [-1, 0] };

  function nodeLabel(n) {
    switch (n.type) {
      case 'hood': return 'Hood Collar';
      case 'vertical': return `Vertical Riser (${fmtFt(n.length)})`;
      case 'horizontal': return `Horizontal Duct (${fmtFt(n.length)})`;
      case 'elbow90': return `90° Elbow → ${n.dir}`;
      case 'elbow45': return `45° Offset (${fmtFt(n.length)})`;
      case 'cleanout': return 'Access Door / Cleanout';
      case 'fan': return 'Rooftop Exhaust Fan';
      default: return 'Duct Section';
    }
  }

  // Compute x/y (world px) for every node from the run description. Honors manual drags (n.manual).
  function layoutNodes(nodes) {
    let x = 0, y = 0, heading = 'up';
    nodes.forEach((n, i) => {
      if (i === 0) { n.x = n.manual ? n.x : 0; n.y = n.manual ? n.y : 0; x = n.x; y = n.y; return; }
      let dx = 0, dy = 0;
      const len = Math.max(0, Number(n.length) || 0) * SCALE;
      switch (n.type) {
        case 'vertical': { const d = (n.dir === 'down') ? 'down' : 'up'; heading = d; [dx, dy] = DIR_VEC[d].map(v => v * len); break; }
        case 'horizontal': { const d = (n.dir === 'left') ? 'left' : 'right'; heading = d; [dx, dy] = DIR_VEC[d].map(v => v * len); break; }
        case 'elbow90': { heading = n.dir || (heading === 'up' ? 'right' : 'up'); [dx, dy] = DIR_VEC[heading].map(v => v * Math.max(1, n.length || 1) * SCALE); break; }
        case 'elbow45': {
          const hx = (n.dir === 'left' || heading === 'left') ? -1 : 1;
          const vy = (n.dir === 'down' || heading === 'down') ? 1 : -1;
          dx = hx * len * 0.7071; dy = vy * len * 0.7071; break;
        }
        case 'cleanout': { [dx, dy] = DIR_VEC[heading].map(v => v * SCALE * 0.75); break; }
        case 'fan': { dx = 0; dy = -Math.max(2, n.length || 3) * SCALE; break; }
        default: { [dx, dy] = DIR_VEC[heading].map(v => v * len); }
      }
      if (n.manual) { x = n.x; y = n.y; } else { x += dx; y += dy; n.x = x; n.y = y; }
    });
    return nodes;
  }

  function totalRunFeet(nodes) {
    return nodes.reduce((a, n) => a + (n.type === 'hood' ? 0 : (Number(n.length) || 0)), 0);
  }

  function nextNodeId() {
    return STATE.project.nodes.reduce((m, n) => Math.max(m, n.id), 0) + 1;
  }

  global.NEXUS = {
    SCALE, APP_VERSION, STATE, $, $$, clamp, fmtFt,
    defaultProject, saveProject, loadProject, projectHash, recordId,
    playBeep, haptic, showToast, layoutNodes, nodeLabel, totalRunFeet, nextNodeId, DIR_VEC
  };
})(window);
