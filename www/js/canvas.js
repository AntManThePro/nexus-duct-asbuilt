/* NEXUS — dual-mode canvas: CAD vector schematic (to scale) + freehand redline, zoom/pan/pinch */
(function (global) {
  'use strict';
  const N = global.NEXUS;
  const { SCALE, STATE, $, clamp, fmtFt, layoutNodes, totalRunFeet, playBeep, haptic, saveProject } = N;

  const canvas = $('systemCanvas');
  const container = $('canvasContainer');
  const ctx = canvas.getContext('2d');
  let dpr = window.devicePixelRatio || 1;
  let flowPhase = 0;
  let animId = null;
  let onNodeSelected = () => {};
  let onNodesChanged = () => {};

  const HOOD_COLORS = { body: '#1e293b', edge: '#60efff', collar: '#38bdf8' };

  // ---------- Geometry helpers ----------
  function hoodRects(project, origin) {
    // Returns array of canopy rects (world px) in elevation view, plus collar points
    const h = project.hood;
    const L = h.length * SCALE, D = h.depth * SCALE * 0.55;
    const topY = origin.y;
    const rects = [];
    if (h.type === 'sbs') {
      const gap = SCALE * 0.5, w = (L - gap) / 2;
      rects.push({ x: origin.x - L / 2, y: topY, w, h: D });
      rects.push({ x: origin.x - L / 2 + w + gap, y: topY, w, h: D });
    } else {
      rects.push({ x: origin.x - L / 2, y: topY, w: L, h: D });
    }
    const collars = [];
    const count = clamp(h.collars, 1, 4);
    for (let i = 0; i < count; i++) {
      const cx = origin.x - L / 2 + (L / (count + 1)) * (i + 1);
      collars.push({ x: cx, y: topY });
    }
    return { rects, collars, L, D };
  }

  function worldBounds(project) {
    const ns = project.nodes;
    const hood = hoodRects(project, ns[0] || { x: 0, y: 0 });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    ns.forEach(n => add(n.x, n.y));
    hood.rects.forEach(r => { add(r.x, r.y); add(r.x + r.w, r.y + r.h + SCALE * 3.2); });
    project.strokes.forEach(s => s.points.forEach(p => add(p.x, p.y)));
    if (!isFinite(minX)) { minX = -100; minY = -100; maxX = 100; maxY = 100; }
    return { minX: minX - 40, minY: minY - 60, maxX: maxX + 40, maxY: maxY + 40 };
  }

  function fitView() {
    const rect = container.getBoundingClientRect();
    const b = worldBounds(STATE.project);
    const bw = Math.max(60, b.maxX - b.minX), bh = Math.max(60, b.maxY - b.minY);
    const zoom = clamp(Math.min(rect.width / bw, rect.height / bh), 0.25, 3);
    STATE.view.zoom = zoom;
    STATE.view.panX = rect.width / 2 - zoom * (b.minX + bw / 2);
    STATE.view.panY = rect.height / 2 - zoom * (b.minY + bh / 2);
    render();
  }

  function zoomBy(factor, cx, cy) {
    const rect = container.getBoundingClientRect();
    cx = cx === undefined ? rect.width / 2 : cx;
    cy = cy === undefined ? rect.height / 2 : cy;
    const v = STATE.view;
    const nz = clamp(v.zoom * factor, 0.2, 5);
    const wx = (cx - v.panX) / v.zoom, wy = (cy - v.panY) / v.zoom;
    v.zoom = nz;
    v.panX = cx - wx * nz; v.panY = cy - wy * nz;
    render();
  }

  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const v = STATE.view;
    return { x: (clientX - rect.left - v.panX) / v.zoom, y: (clientY - rect.top - v.panY) / v.zoom };
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    render();
  }

  // ---------- Rendering ----------
  function render(targetCtx, opts) {
    const c = targetCtx || ctx;
    const view = (opts && opts.view) || STATE.view;
    const scale = (opts && opts.dpr) || dpr;
    const w = (opts && opts.width) || canvas.width / dpr;
    const h = (opts && opts.height) || canvas.height / dpr;
    const project = STATE.project;
    layoutNodes(project.nodes);

    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.clearRect(0, 0, w, h);
    if (opts && opts.background) { c.fillStyle = opts.background; c.fillRect(0, 0, w, h); drawGrid(c, w, h, view); }
    c.setTransform(scale * view.zoom, 0, 0, scale * view.zoom, scale * view.panX, scale * view.panY);

    const ns = project.nodes;
    if (!ns.length) return;
    const z = view.zoom;
    const hood = hoodRects(project, ns[0]);

    drawHood(c, project, hood, z);
    drawDucts(c, ns, z);
    drawNodes(c, ns, z, opts && opts.noSelection);
    drawStrokes(c, project.strokes);

    if (!targetCtx) {
      const stats = $('canvasStatsLabel');
      if (stats) stats.textContent = `NODES: ${ns.length} // RUN: ${totalRunFeet(ns)} FT // HOOD: ${project.hood.length}' ${project.hood.type.toUpperCase()} // ZOOM ${(z * 100) | 0}%`;
    }
  }

  function drawGrid(c, w, h, view) {
    const step = SCALE * view.zoom;
    if (step < 6) return;
    c.strokeStyle = 'rgba(0,229,255,0.06)'; c.lineWidth = 1;
    const ox = ((view.panX % step) + step) % step, oy = ((view.panY % step) + step) % step;
    c.beginPath();
    for (let x = ox; x < w; x += step) { c.moveTo(x, 0); c.lineTo(x, h); }
    for (let y = oy; y < h; y += step) { c.moveTo(0, y); c.lineTo(w, y); }
    c.stroke();
  }

  function drawHood(c, project, hood, z) {
    const { rects, collars, L } = hood;
    const origin = project.nodes[0];
    c.lineWidth = 2 / z;
    rects.forEach(r => {
      // canopy trapezoid (elevation)
      c.beginPath();
      c.moveTo(r.x, r.y); c.lineTo(r.x + r.w, r.y);
      c.lineTo(r.x + r.w - SCALE * 0.4, r.y + r.h); c.lineTo(r.x + SCALE * 0.4, r.y + r.h); c.closePath();
      c.fillStyle = HOOD_COLORS.body; c.fill();
      c.strokeStyle = HOOD_COLORS.edge; c.stroke();
      // grease filter bank
      c.strokeStyle = 'rgba(96,239,255,0.35)'; c.lineWidth = 1 / z;
      const fy = r.y + r.h * 0.35;
      for (let x = r.x + SCALE * 0.8; x < r.x + r.w - SCALE * 0.6; x += SCALE * 1.3) { c.strokeRect(x, fy, SCALE * 1.1, r.h * 0.4); }
      c.lineWidth = 2 / z;
    });
    // island: show a second (back) edge to indicate four-sided canopy
    if (project.hood.type === 'island') {
      const r = rects[0];
      c.strokeStyle = 'rgba(96,239,255,0.5)'; c.setLineDash([4 / z, 4 / z]);
      c.strokeRect(r.x - SCALE * 0.3, r.y - SCALE * 0.3, r.w + SCALE * 0.6, r.h + SCALE * 0.3);
      c.setLineDash([]);
    }
    // collars
    collars.forEach(k => {
      c.fillStyle = HOOD_COLORS.collar;
      c.fillRect(k.x - SCALE * 0.45, k.y - SCALE * 0.6, SCALE * 0.9, SCALE * 0.6);
    });
    // Dimension line
    const r0 = rects[0], rEnd = rects[rects.length - 1];
    const dy = r0.y + r0.h + SCALE * 0.6;
    c.strokeStyle = '#ffb300'; c.lineWidth = 1 / z;
    c.beginPath(); c.moveTo(r0.x, dy); c.lineTo(rEnd.x + rEnd.w, dy); c.stroke();
    c.beginPath(); c.moveTo(r0.x, dy - 4 / z); c.lineTo(r0.x, dy + 4 / z); c.moveTo(rEnd.x + rEnd.w, dy - 4 / z); c.lineTo(rEnd.x + rEnd.w, dy + 4 / z); c.stroke();
    c.fillStyle = '#ffb300'; c.font = `${10 / z}px ui-monospace, monospace`; c.textAlign = 'center'; c.textBaseline = 'top';
    const typeLbl = { wall: 'WALL CANOPY', sbs: 'SIDE-BY-SIDE', island: 'ISLAND CANOPY' }[project.hood.type] || 'HOOD';
    c.fillText(`${typeLbl}  ${fmtFt(project.hood.length)} × ${fmtFt(project.hood.depth)} · ${project.hood.collars} COLLAR${project.hood.collars > 1 ? 'S' : ''}`, origin.x, dy + 3 / z);

    // Appliances under canopy, to scale
    const ay = dy + SCALE * 1.2;
    let ax = r0.x;
    const totalW = project.appliances.reduce((a, p) => a + (Number(p.width) || 0), 0) * SCALE;
    const over = totalW > L;
    project.appliances.forEach(a => {
      const aw = Math.max(SCALE * 0.5, (Number(a.width) || 1) * SCALE), ah = SCALE * 1.6;
      const colors = { light: '#38bdf8', medium: '#00e676', heavy: '#ffb300', 'extra-heavy': '#ff3d00' };
      c.fillStyle = 'rgba(17,23,36,0.9)'; c.strokeStyle = colors[a.cls] || '#94a3b8'; c.lineWidth = 1.5 / z;
      c.fillRect(ax, ay, aw, ah); c.strokeRect(ax, ay, aw, ah);
      c.fillStyle = '#e2e8f0'; c.font = `${8 / z}px ui-monospace, monospace`; c.textAlign = 'center'; c.textBaseline = 'middle';
      const label = a.name.length > 14 ? a.name.slice(0, 13) + '…' : a.name;
      if (aw * z > 28) c.fillText(label, ax + aw / 2, ay + ah / 2);
      ax += aw;
    });
    if (over) {
      c.fillStyle = '#ff3d00'; c.font = `bold ${9 / z}px ui-monospace, monospace`; c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText('⚠ APPLIANCE LINE EXCEEDS HOOD LENGTH', r0.x, ay + SCALE * 1.8);
    }
  }

  function drawDucts(c, ns, z) {
    for (let i = 0; i < ns.length - 1; i++) {
      const a = ns[i], b = ns[i + 1];
      const seg = (w, color) => { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = color; c.lineWidth = w; c.lineCap = 'butt'; c.stroke(); };
      seg(26, '#1e293b'); seg(14, '#38bdf8'); seg(8, '#0c111a');
      // animated flow (hood → fan)
      c.save();
      c.setLineDash([6, 10]); c.lineDashOffset = -flowPhase;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
      c.strokeStyle = 'rgba(0,229,255,0.75)'; c.lineWidth = 2; c.stroke();
      c.restore();
      // footage tag
      if (b.type !== 'cleanout' && b.type !== 'elbow90' && b.type !== 'fan' && b.length) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const tw = 44, th = 16;
        c.fillStyle = '#070a0f'; c.strokeStyle = '#00e5ff'; c.lineWidth = 1 / z;
        c.fillRect(mx - tw / 2, my - th / 2, tw, th); c.strokeRect(mx - tw / 2, my - th / 2, tw, th);
        c.fillStyle = '#00e5ff'; c.font = 'bold 9px ui-monospace, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(`${fmtFt(Number(b.length))}`, mx, my);
      }
    }
  }

  function drawNodes(c, ns, z, noSelection) {
    ns.forEach((n, i) => {
      const sel = !noSelection && STATE.selectedNodeIndex === i;
      if (sel) {
        c.beginPath(); c.arc(n.x, n.y, 22, 0, Math.PI * 2);
        c.strokeStyle = '#00e5ff'; c.lineWidth = 2 / z; c.setLineDash([4, 4]); c.stroke(); c.setLineDash([]);
      }
      c.textAlign = 'center';
      if (n.type === 'hood') {
        // collar transition marker
        c.fillStyle = '#00e5ff'; c.beginPath(); c.arc(n.x, n.y, 5, 0, Math.PI * 2); c.fill();
      } else if (n.type === 'fan') {
        c.fillStyle = '#00e676'; c.beginPath(); c.arc(n.x, n.y, 16, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
        // fan blades
        c.strokeStyle = '#070a0f'; c.lineWidth = 2;
        for (let k = 0; k < 3; k++) { const a = flowPhase / 10 + k * Math.PI * 2 / 3; c.beginPath(); c.moveTo(n.x, n.y); c.lineTo(n.x + Math.cos(a) * 11, n.y + Math.sin(a) * 11); c.stroke(); }
        // roof line & curb
        c.strokeStyle = '#ffb300'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(n.x - 48, n.y + 22); c.lineTo(n.x + 48, n.y + 22); c.stroke();
        c.fillStyle = '#ffb300'; c.font = '8px ui-monospace, monospace'; c.textBaseline = 'top';
        c.fillText(STATE.project.site.fanType === 'upblast_unhinged' ? 'ROOF · ⚠ NON-HINGED' : 'ROOF · HINGED BASE', n.x, n.y + 25);
      } else if (n.type === 'cleanout') {
        c.fillStyle = '#00e676'; c.fillRect(n.x - 9, n.y - 9, 18, 18);
        c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.strokeRect(n.x - 9, n.y - 9, 18, 18);
      } else {
        c.fillStyle = n.hasDoor ? '#00e676' : '#ff3d00';
        c.beginPath(); c.arc(n.x, n.y, 8, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke();
      }
      if (n.hasDoor && n.type !== 'hood' && n.type !== 'fan' && n.type !== 'cleanout') {
        c.fillStyle = '#00e676'; c.fillRect(n.x - 13, n.y - 26, 26, 12);
        c.fillStyle = '#070a0f'; c.font = 'bold 8px ui-monospace, monospace'; c.textBaseline = 'middle'; c.fillText('DOOR', n.x, n.y - 20);
      }
      if (n.type !== 'hood') {
        // Place labels where they don't collide: segments at their midpoint, fittings offset diagonally
        const prev = ns[i - 1] || n;
        let lx = n.x, ly = n.y + 12, align = 'center';
        if (n.type === 'vertical') { lx = (prev.x + n.x) / 2 + 14; ly = (prev.y + n.y) / 2 + 14; align = 'left'; }
        else if (n.type === 'horizontal') { lx = (prev.x + n.x) / 2; ly = (prev.y + n.y) / 2 + 14; }
        else if (n.type === 'elbow90' || n.type === 'elbow45') { lx = n.x + (n.dir === 'left' ? -14 : 14); ly = n.y - 36; align = n.dir === 'left' ? 'right' : 'left'; }
        else if (n.type === 'fan') { ly = n.y - 30; }
        else if (n.type === 'cleanout') { lx = n.x + 14; ly = n.y - 4; align = 'left'; }
        c.fillStyle = '#94a3b8'; c.font = '9px ui-monospace, monospace'; c.textBaseline = 'top'; c.textAlign = align;
        c.fillText(n.label, lx, ly);
        if (n.note) { c.fillStyle = '#ff0080'; c.fillText(`✎ ${n.note.slice(0, 28)}`, lx, ly + 11); }
        c.textAlign = 'center';
      }
    });
  }

  function drawStrokes(c, strokes) {
    strokes.forEach(s => {
      if (s.points.length < 2) return;
      c.beginPath(); c.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) c.lineTo(s.points[i].x, s.points[i].y);
      c.strokeStyle = s.color; c.lineWidth = s.width; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
    });
  }

  // ---------- Animation loop (only while visible) ----------
  function tick() {
    flowPhase = (flowPhase + 0.6) % 1000;
    if (container.offsetParent !== null) render();
    animId = requestAnimationFrame(tick);
  }
  function startAnim() { if (!animId) animId = requestAnimationFrame(tick); }
  function stopAnim() { if (animId) { cancelAnimationFrame(animId); animId = null; } }
  document.addEventListener('visibilitychange', () => (document.hidden ? stopAnim() : startAnim()));

  // ---------- Pointer interaction ----------
  const pointers = new Map();
  let drag = null; // { kind: 'node'|'pan'|'draw', ... }
  let pinch = null;

  function hitNode(world) {
    const r = 24 / STATE.view.zoom;
    let best = -1, bestD = Infinity;
    STATE.project.nodes.forEach((n, i) => { const d = Math.hypot(n.x - world.x, n.y - world.y); if (d <= r && d < bestD) { bestD = d; best = i; } });
    return best;
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: STATE.view.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, panX: STATE.view.panX, panY: STATE.view.panY };
      if (drag && drag.kind === 'draw') STATE.project.strokes.pop();
      drag = null;
      return;
    }
    const world = toWorld(e.clientX, e.clientY);
    const mode = STATE.canvasMode;
    if (mode === 'draw') {
      drag = { kind: 'draw' };
      STATE.project.strokes.push({ color: STATE.drawColor, width: STATE.drawWidth / STATE.view.zoom, points: [world] });
      playBeep(900, 'sine', 0.02);
    } else if (mode === 'pan') {
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, panX: STATE.view.panX, panY: STATE.view.panY };
    } else {
      const idx = hitNode(world);
      if (idx !== -1) {
        drag = { kind: 'node', idx, sx: e.clientX, sy: e.clientY, ox: STATE.project.nodes[idx].x, oy: STATE.project.nodes[idx].y, moved: false };
        STATE.selectedNodeIndex = idx;
        onNodeSelected(idx);
        playBeep(650, 'sine', 0.06); haptic('LIGHT');
      } else {
        drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, panX: STATE.view.panX, panY: STATE.view.panY, deselect: true };
      }
      render();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = canvas.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - rect.left, cy = (a.y + b.y) / 2 - rect.top;
      const nz = clamp(pinch.zoom * (dist / pinch.dist), 0.2, 5);
      const wx = (pinch.cx - rect.left - pinch.panX) / pinch.zoom, wy = (pinch.cy - rect.top - pinch.panY) / pinch.zoom;
      STATE.view.zoom = nz; STATE.view.panX = cx - wx * nz; STATE.view.panY = cy - wy * nz;
      render();
      return;
    }
    if (!drag) return;
    e.preventDefault();
    if (drag.kind === 'draw') {
      const s = STATE.project.strokes[STATE.project.strokes.length - 1];
      if (s) { s.points.push(toWorld(e.clientX, e.clientY)); render(); }
    } else if (drag.kind === 'pan') {
      STATE.view.panX = drag.panX + (e.clientX - drag.sx);
      STATE.view.panY = drag.panY + (e.clientY - drag.sy);
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.deselect = false;
      render();
    } else if (drag.kind === 'node') {
      const dx = (e.clientX - drag.sx) / STATE.view.zoom, dy = (e.clientY - drag.sy) / STATE.view.zoom;
      if (Math.hypot(dx, dy) > 3 / STATE.view.zoom) {
        const n = STATE.project.nodes[drag.idx];
        n.x = drag.ox + dx; n.y = drag.oy + dy; n.manual = true; drag.moved = true;
        render();
      }
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    if (drag.kind === 'draw') { playBeep(450, 'sine', 0.03); saveProject(); }
    if (drag.kind === 'pan' && drag.deselect) { STATE.selectedNodeIndex = null; onNodeSelected(null); render(); }
    if (drag.kind === 'node' && drag.moved) { saveProject(); onNodesChanged(); }
    drag = null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  // ---------- Export rendering ----------
  function exportPNG(withTitleBlock = true) {
    const project = STATE.project;
    const b = worldBounds(project);
    const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
    const W = 1600, pad = 60, titleH = withTitleBlock ? 150 : 0;
    const zoom = Math.min((W - pad * 2) / bw, 2.2);
    const H = Math.round(bh * zoom + pad * 2 + titleH);
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const c = off.getContext('2d');
    const view = { zoom, panX: pad - b.minX * zoom, panY: pad - b.minY * zoom };
    render(c, { view, dpr: 1, width: W, height: H - titleH, background: '#070a0f', noSelection: true });
    if (withTitleBlock) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      const y0 = H - titleH;
      c.fillStyle = '#0c111a'; c.fillRect(0, y0, W, titleH);
      c.strokeStyle = '#00e5ff'; c.lineWidth = 2; c.strokeRect(1, y0 + 1, W - 2, titleH - 2);
      c.fillStyle = '#fff'; c.font = 'bold 28px ui-monospace, monospace'; c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText('NEXUS  ·  DUCT AS-BUILT', 30, y0 + 22);
      c.fillStyle = '#94a3b8'; c.font = '15px ui-monospace, monospace';
      c.fillText(`${project.site.name}   |   AHJ: ${project.site.ahj}`, 30, y0 + 62);
      c.fillText(`Tech: ${project.site.technician}   |   Date: ${project.site.date}   |   Record ${N.recordId()}`, 30, y0 + 86);
      const a = STATE.audit;
      c.fillStyle = a.violations.length ? '#ff3d00' : '#00e676'; c.font = 'bold 18px ui-monospace, monospace'; c.textAlign = 'right';
      c.fillText(a.violations.length ? `${a.violations.length} HAZARD(S) FLAGGED · SCORE ${a.score}%` : `NFPA 96 COMPLIANT AS RECORDED · ${a.score}%`, W - 30, y0 + 26);
      c.fillStyle = '#64748b'; c.font = '12px ui-monospace, monospace';
      c.fillText(`Run ${totalRunFeet(project.nodes)} ft · ${project.nodes.length} nodes · Hood ${project.hood.length}' ${project.hood.type} · ${project.hood.collars} collar(s) · Hash ${N.projectHash()}`, W - 30, y0 + 64);
      c.fillText('NExtended Xperimental USers · DoubleA · AntManThePro · generated offline', W - 30, y0 + 86);
    }
    return off.toDataURL('image/png');
  }

  N.canvas = {
    render, resize, fitView, zoomBy, exportPNG, startAnim, stopAnim,
    setOnNodeSelected: (fn) => { onNodeSelected = fn; },
    setOnNodesChanged: (fn) => { onNodesChanged = fn; },
    setMode(mode) {
      STATE.canvasMode = mode;
      container.classList.toggle('pan', mode === 'pan');
      container.classList.toggle('draw', mode === 'draw');
    }
  };
})(window);
