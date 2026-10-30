/* NEXUS — UI controller: wizard, dossier, library, node editor, briefing, exports, native bridges */
(function (global) {
  'use strict';
  const N = global.NEXUS;
  const { STATE, $, $$, clamp, fmtFt, saveProject, loadProject, defaultProject, showToast, playBeep, haptic, nodeLabel, layoutNodes, nextNodeId } = N;
  const C = N.canvas;
  const A = N.audit;
  const P = N.parser;
  const STEPS = ['Dossier', 'Slang Parser', 'CAD & Redline', 'NFPA 96 Audit', 'Packet & Export'];

  const isNative = () => !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
  const plugin = (name) => (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins[name]) || null;

  function refresh({ layout = true, audit = true, save = true } = {}) {
    if (layout) layoutNodes(STATE.project.nodes);
    C.render();
    if (audit) A.runComplianceAudit();
    if (save) saveProject();
  }

  // ---------- Wizard / view ----------
  function setWizardStep(step) {
    STATE.currentStep = clamp(step, 1, 5);
    playBeep(520, 'sine', 0.05);
    if (STATE.viewMode === 'wizard') {
      for (let s = 1; s <= 5; s++) $(`step${s}Container`).classList.toggle('hidden', s !== STATE.currentStep);
    }
    $$('.wstep').forEach(b => {
      const s = Number(b.dataset.step);
      b.classList.toggle('on', s === STATE.currentStep);
      b.classList.toggle('done', s < STATE.currentStep);
    });
    $('bottomStatus').textContent = `Step ${STATE.currentStep} of 5 — ${STEPS[STATE.currentStep - 1]}`;
    $('prevStepBtn').disabled = STATE.currentStep === 1;
    $('nextStepBtn').textContent = STATE.currentStep === 5 ? 'PREVIEW PACKET' : 'NEXT →';
    if (STATE.currentStep === 3 || STATE.viewMode === 'pro') setTimeout(() => { C.resize(); C.fitView(); }, 40);
    if (STATE.currentStep === 4) A.runComplianceAudit();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setViewMode(mode) {
    STATE.viewMode = mode;
    $('viewWizardBtn').classList.toggle('on', mode === 'wizard');
    $('viewProBtn').classList.toggle('on', mode === 'pro');
    $('wizardNavBar').classList.toggle('hidden', mode === 'pro');
    $('bottomNav').classList.toggle('hidden', mode === 'pro');
    if (mode === 'pro') {
      for (let s = 1; s <= 5; s++) $(`step${s}Container`).classList.remove('hidden');
      setTimeout(() => { C.resize(); C.fitView(); }, 40);
    } else {
      setWizardStep(STATE.currentStep);
    }
  }

  // ---------- Dossier bindings ----------
  const SITE_FIELDS = { siteNameInput: 'name', ahjCodeInput: 'ahj', technicianInput: 'technician', dateInput: 'date', dutyLevelSelect: 'duty', fanTypeSelect: 'fanType', spanRuleSelect: 'spanRule', volumeSelect: 'volume' };
  const PACKET_FIELDS = { pkDrawings: 'drawings', pkInstructions: 'instructions', pkElectrical: 'electrical', pkComponents: 'components', pkCleaning: 'cleaning' };

  function bindDossier() {
    Object.entries(SITE_FIELDS).forEach(([id, key]) => {
      const el = $(id);
      el.addEventListener('input', () => {
        STATE.project.site[key] = key === 'spanRule' ? Number(el.value) : el.value;
        refresh({ layout: false });
      });
    });
    Object.entries(PACKET_FIELDS).forEach(([id, key]) => {
      $(id).addEventListener('change', (e) => { STATE.project.packet[key] = e.target.checked; refresh({ layout: false }); });
    });
    $('permitGapCheck').addEventListener('change', (e) => { STATE.project.site.permitGap = e.target.checked; refresh({ layout: false }); });

    $$('.hood-type').forEach(b => b.addEventListener('click', () => {
      STATE.project.hood.type = b.dataset.hood;
      $$('.hood-type').forEach(x => x.classList.toggle('on', x === b));
      playBeep(700, 'sine', 0.05);
      refresh({ layout: false });
    }));
    const ranges = [['hoodLengthRange', 'length', 'hoodLengthOut', v => `${Number(v).toFixed(1)} ft`], ['hoodDepthRange', 'depth', 'hoodDepthOut', v => `${Number(v).toFixed(1)} ft`], ['collarRange', 'collars', 'collarOut', v => `${v}`]];
    ranges.forEach(([id, key, out, fmt]) => {
      $(id).addEventListener('input', (e) => {
        STATE.project.hood[key] = Number(e.target.value);
        $(out).textContent = fmt(e.target.value);
        refresh({ layout: false });
      });
    });

    $('addApplianceBtn').addEventListener('click', () => {
      const name = $('applNameInput').value.trim();
      if (!name) { showToast('Enter an appliance name.', 'warn'); return; }
      STATE.project.appliances.push({ name, cls: $('applClassSelect').value, width: Number($('applWidthInput').value) || 2 });
      $('applNameInput').value = '';
      renderAppliances();
      showToast(`Added "${name}" under canopy.`);
      refresh({ layout: false });
    });
    $('applNameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('addApplianceBtn').click(); } });
  }

  function renderAppliances() {
    const list = $('applianceList');
    const apps = STATE.project.appliances;
    const cadence = { light: 'Annually', medium: 'Semiannually', heavy: 'Quarterly', 'extra-heavy': 'Monthly' };
    list.innerHTML = apps.map((a, i) => `
      <div class="appl-item">
        <div><div class="name">${escapeHTML(a.name)}</div><div class="meta">${a.cls.replace('-', ' ').toUpperCase()} · ${fmtFt(Number(a.width))} · inspect ${cadence[a.cls] || 'Semiannually'}</div></div>
        <button class="btn sm hazard" data-del="${i}" aria-label="Remove">✕</button>
      </div>`).join('') || '<div class="help">No appliances recorded. Add the cooking line under this hood.</div>';
    list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      apps.splice(Number(b.dataset.del), 1); renderAppliances(); refresh({ layout: false });
    }));
    const total = apps.reduce((s, a) => s + (Number(a.width) || 0), 0);
    $('applianceSummary').textContent = apps.length ? `${apps.length} appliance(s) · ${fmtFt(total)} line under ${fmtFt(STATE.project.hood.length)} hood` : '';
  }

  function hydrateDossier() {
    const s = STATE.project.site, h = STATE.project.hood, k = STATE.project.packet;
    Object.entries(SITE_FIELDS).forEach(([id, key]) => { $(id).value = s[key]; });
    Object.entries(PACKET_FIELDS).forEach(([id, key]) => { $(id).checked = !!k[key]; });
    $('permitGapCheck').checked = !!s.permitGap;
    $$('.hood-type').forEach(x => x.classList.toggle('on', x.dataset.hood === h.type));
    $('hoodLengthRange').value = h.length; $('hoodLengthOut').textContent = `${Number(h.length).toFixed(1)} ft`;
    $('hoodDepthRange').value = h.depth; $('hoodDepthOut').textContent = `${Number(h.depth).toFixed(1)} ft`;
    $('collarRange').value = h.collars; $('collarOut').textContent = `${h.collars}`;
    $('slangTextInput').value = STATE.project.slangText || '';
    renderAppliances();
  }

  // ---------- Parser UI ----------
  function executeParsing() {
    const text = $('slangTextInput').value.trim();
    if (!text) { showToast('Type or dictate a duct description first.', 'warn'); return; }
    const { nodes, telemetry } = P.parseNaturalLanguageDuctRun(text);
    STATE.project.nodes = nodes;
    STATE.project.slangText = text;
    STATE.project.strokes = [];
    STATE.selectedNodeIndex = null;
    closeNodeEditor();
    const chips = $('tokenChips');
    chips.innerHTML = nodes.slice(1).map(n => `<span class="${n.hasDoor ? '' : 'nodoor'}">#${n.id} ${escapeHTML(n.label)}${n.hasDoor ? ' ✓door' : ''}</span>`).join('');
    $('tokenCountLabel').textContent = `${nodes.length} NODES · ${N.totalRunFeet(nodes)} FT`;
    showToast(`Compiled ${nodes.length} nodes into the schematic.`);
    haptic('MEDIUM');
    refresh();
    C.fitView();
  }

  function bindParser() {
    $('parseRunBtn').addEventListener('click', executeParsing);
    $$('.sample-btn').forEach(b => b.addEventListener('click', () => { $('slangTextInput').value = b.dataset.sample; playBeep(750, 'sine', 0.05); executeParsing(); }));
    $('slangTextInput').addEventListener('input', () => { STATE.project.slangText = $('slangTextInput').value; saveProject(); });

    const SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    const voiceBtn = $('voiceBtn');
    let rec = null;
    voiceBtn.addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      if (!SR) {
        $('slangTextInput').value = 'Hood collar riser 10ft dogleg 90 right horizontal 24ft with access door slant 45 up 8ft to hinged upblast fan';
        showToast('Speech recognition unavailable here — loaded a simulated dispatch.', 'warn');
        executeParsing();
        return;
      }
      rec = new SR();
      rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
      voiceBtn.classList.add('mic-live'); $('voiceBtnLabel').textContent = 'LISTENING…';
      let finalText = '';
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' '; else interim += e.results[i][0].transcript;
        }
        $('slangTextInput').value = (finalText + interim).trim();
      };
      rec.onerror = (e) => { showToast(`Mic error: ${e.error}`, 'error'); };
      rec.onend = () => {
        voiceBtn.classList.remove('mic-live'); $('voiceBtnLabel').textContent = 'DICTATE'; rec = null;
        if ($('slangTextInput').value.trim()) executeParsing();
      };
      try { rec.start(); playBeep(1000, 'sine', 0.08); } catch (err) { rec = null; showToast('Could not start microphone.', 'error'); }
    });
  }

  // ---------- Canvas toolbar / library / node editor ----------
  const LIBRARY = [
    { type: 'vertical', dir: 'up', length: 8, label: 'Riser ↑ 8 ft', sub: 'vertical duct' },
    { type: 'vertical', dir: 'down', length: 4, label: 'Drop ↓ 4 ft', sub: 'vertical duct' },
    { type: 'elbow90', dir: 'right', length: 1, label: '90° Elbow →', sub: 'direction change', hasDoor: true },
    { type: 'elbow90', dir: 'left', length: 1, label: '90° Elbow ←', sub: 'direction change', hasDoor: true },
    { type: 'elbow90', dir: 'up', length: 1, label: '90° Elbow ↑', sub: 'direction change', hasDoor: true },
    { type: 'horizontal', dir: 'right', length: 10, label: 'Horizontal → 10 ft', sub: 'ceiling run' },
    { type: 'horizontal', dir: 'left', length: 10, label: 'Horizontal ← 10 ft', sub: 'ceiling run' },
    { type: 'elbow45', dir: 'right', length: 4, label: '45° Offset 4 ft', sub: 'slant / kick', hasDoor: true },
    { type: 'cleanout', dir: 'up', length: 0, label: 'Access Door', sub: 'listed cleanout', hasDoor: true },
    { type: 'fan', dir: 'up', length: 3, label: 'Rooftop Fan', sub: 'termination', hasDoor: true }
  ];

  function appendNode(spec) {
    const ns = STATE.project.nodes;
    const fanIdx = ns.findIndex(n => n.type === 'fan');
    const node = { id: nextNodeId(), type: spec.type, dir: spec.dir, length: spec.length, hasDoor: !!spec.hasDoor, note: '' };
    node.label = nodeLabel(node);
    if (spec.type === 'fan') {
      if (fanIdx !== -1) { showToast('Run already terminates at a fan.', 'warn'); return; }
      ns.push(node);
    } else if (fanIdx !== -1) {
      ns.splice(fanIdx, 0, node); // insert before the fan so the run stays hood → fan
    } else {
      ns.push(node);
    }
    ns.forEach(n => { if (n.type === 'fan') n.manual = false; });
    showToast(`Added ${node.label}.`);
    haptic('LIGHT');
    refresh();
    C.fitView();
  }

  function openNodeEditor(idx) {
    if (idx === null || idx === undefined) { closeNodeEditor(); return; }
    const n = STATE.project.nodes[idx];
    $('nodeEditorBox').classList.remove('hidden');
    $('selectedNodeTitle').textContent = `EDIT NODE #${n.id} — ${n.label.toUpperCase()}`;
    $('nodeLengthInput').value = n.length || 0;
    $('nodeTypeSelect').value = n.type;
    $('nodeDirSelect').value = n.dir || 'up';
    $('nodeDoorSelect').value = n.hasDoor ? 'yes' : 'no';
    $('nodeNoteInput').value = n.note || '';
  }
  function closeNodeEditor() {
    $('nodeEditorBox').classList.add('hidden');
    STATE.selectedNodeIndex = null;
  }

  function bindCanvasUI() {
    C.setOnNodeSelected(openNodeEditor);
    C.setOnNodesChanged(() => A.runComplianceAudit());

    const modeBtns = { cad: $('modeCadBtn'), pan: $('modePanBtn'), draw: $('modeDrawBtn') };
    Object.entries(modeBtns).forEach(([mode, btn]) => btn.addEventListener('click', () => {
      C.setMode(mode);
      Object.entries(modeBtns).forEach(([m, b]) => b.classList.toggle('on', m === mode));
      $('redlineToolbar').classList.toggle('hidden', mode !== 'draw');
      if (mode === 'draw') { closeNodeEditor(); showToast('Redline pen active — circle obstacles and notes.', 'warn'); }
      else if (mode === 'pan') showToast('Pan mode — drag to move, pinch/wheel to zoom.');
      else showToast('CAD mode — tap a node to edit, drag to reposition.');
    }));

    $$('.color-btn').forEach(b => b.addEventListener('click', () => {
      $$('.color-btn').forEach(x => x.classList.toggle('on', x === b));
      STATE.drawColor = b.dataset.color; playBeep(600, 'sine', 0.04);
    }));
    $('penWidthSelect').addEventListener('change', (e) => { STATE.drawWidth = Number(e.target.value); });
    $('undoStrokeBtn').addEventListener('click', () => { STATE.project.strokes.pop(); refresh({ audit: false }); });
    $('clearRedlineBtn').addEventListener('click', () => { STATE.project.strokes = []; refresh({ audit: false }); showToast('Redline markup cleared.'); });
    $('autoLayoutBtn').addEventListener('click', () => { STATE.project.nodes.forEach(n => { n.manual = false; }); refresh(); C.fitView(); showToast('Auto-layout applied from run description.'); });
    $('resetCanvasBtn').addEventListener('click', () => {
      if (!confirm('Reset the entire project to the factory baseline? This clears nodes, markup, appliances and dossier.')) return;
      STATE.project = defaultProject();
      hydrateDossier(); closeNodeEditor();
      refresh(); C.fitView();
      showToast('Project reset to factory baseline.', 'warn');
    });
    $('zoomInBtn').addEventListener('click', () => C.zoomBy(1.25));
    $('zoomOutBtn').addEventListener('click', () => C.zoomBy(0.8));
    $('zoomFitBtn').addEventListener('click', () => C.fitView());

    $('toggleLibBtn').addEventListener('click', () => $('libraryPanel').classList.toggle('hidden'));
    $('libraryGrid').innerHTML = LIBRARY.map((l, i) => `<button class="lib-item" data-lib="${i}"><b>${l.label}</b><small>${l.sub}</small></button>`).join('');
    $$('[data-lib]').forEach(b => b.addEventListener('click', () => appendNode(LIBRARY[Number(b.dataset.lib)])));

    $('closeNodeBtn').addEventListener('click', () => { closeNodeEditor(); C.render(); });
    $('saveNodeBtn').addEventListener('click', () => {
      const idx = STATE.selectedNodeIndex; if (idx === null) return;
      const n = STATE.project.nodes[idx];
      n.length = Math.max(0, parseFloat($('nodeLengthInput').value) || 0);
      n.type = $('nodeTypeSelect').value;
      n.dir = $('nodeDirSelect').value;
      n.hasDoor = $('nodeDoorSelect').value === 'yes';
      n.note = $('nodeNoteInput').value.trim();
      n.manual = false;
      n.label = nodeLabel(n);
      showToast(`Node #${n.id} updated.`);
      closeNodeEditor(); refresh(); C.fitView();
    });
    $('deleteNodeBtn').addEventListener('click', () => {
      const idx = STATE.selectedNodeIndex; if (idx === null) return;
      if (STATE.project.nodes[idx].type === 'hood') { showToast('The hood collar is the run origin and cannot be deleted.', 'warn'); return; }
      const id = STATE.project.nodes[idx].id;
      STATE.project.nodes.splice(idx, 1);
      showToast(`Removed node #${id}.`, 'warn');
      closeNodeEditor(); refresh(); C.fitView();
    });
  }

  // ---------- Briefing player ----------
  const tut = { playing: false, progress: 0, anim: null };
  const tutCanvas = $('tutorialCanvas');
  const tutCtx = tutCanvas.getContext('2d');
  function resizeTutorial() {
    const r = tutCanvas.getBoundingClientRect(); if (!r.width) return;
    const d = window.devicePixelRatio || 1;
    tutCanvas.width = r.width * d; tutCanvas.height = r.height * d;
    tutCtx.setTransform(d, 0, 0, d, 0, 0);
  }
  function drawTutorialFrame() {
    const r = tutCanvas.getBoundingClientRect(); const w = r.width, h = r.height; if (!w) return;
    const c = tutCtx; const f = tut.progress / 100;
    c.fillStyle = '#070a0f'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(0,229,255,0.1)'; c.lineWidth = 1; c.beginPath();
    for (let x = 0; x < w; x += 25) { c.moveTo(x, 0); c.lineTo(x, h); }
    for (let y = 0; y < h; y += 25) { c.moveTo(0, y); c.lineTo(w, y); }
    c.stroke();
    c.fillStyle = '#1f2d47'; c.strokeStyle = '#00e5ff'; c.lineWidth = 2;
    c.fillRect(w * .15, h * .75, w * .2, h * .12); c.strokeRect(w * .15, h * .75, w * .2, h * .12);
    c.fillStyle = '#fff'; c.font = '10px ui-monospace, monospace'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText('COOKING HOOD', w * .16, h * .82);
    const riser = h * .45 * Math.min(1, f * 2.5);
    c.beginPath(); c.moveTo(w * .25, h * .75); c.lineTo(w * .25, h * .75 - riser); c.strokeStyle = '#00e5ff'; c.lineWidth = 14; c.lineCap = 'round'; c.stroke();
    if (f > .4) {
      const len = w * .45 * Math.min(1, (f - .4) * 2.5);
      c.beginPath(); c.moveTo(w * .25, h * .3); c.lineTo(w * .25 + len, h * .3); c.stroke();
      c.fillStyle = '#ffb300'; c.font = '11px ui-monospace, monospace'; c.fillText(`NFPA 96 ${STATE.project.site.spanRule} FT ACCESS RULE`, w * .35, h * .24);
      c.fillStyle = '#00e676'; c.fillRect(w * .25 - 8, h * .3 - 22, 16, 8);
      if (len > w * .2) c.fillRect(w * .25 + len * .5 - 8, h * .3 - 22, 16, 8);
    }
    if (f > .8) { c.fillStyle = '#00e676'; c.beginPath(); c.arc(w * .75, h * .25, 18, 0, Math.PI * 2); c.fill(); c.fillStyle = '#070a0f'; c.fillText('FAN', w * .73, h * .27); }
    c.strokeStyle = 'rgba(0,229,255,0.4)'; c.lineWidth = 2; c.beginPath(); c.moveTo(w * f, 0); c.lineTo(w * f, h); c.stroke();
  }
  function tutLoop() {
    if (!tut.playing) return;
    tut.progress = (tut.progress + 0.45) % 100;
    const sec = Math.floor(tut.progress / 100 * 24);
    $('videoDurationLabel').textContent = `00:${sec < 10 ? '0' : ''}${sec} / 00:24`;
    $('videoProgressFill').style.width = `${tut.progress}%`;
    const p = tut.progress;
    const [hud, head, sub] = p < 30
      ? ['MODULE 01 // HOOD & RISER', 'Step 1: Ingest Hood, Appliances & Riser', 'Pick wall, side-by-side or island canopy, size it in feet, add the cooking line. NEXUS checks coverage and duty class against every appliance.']
      : p < 70
        ? ['MODULE 02 // ACCESS INTERVALS', `Step 2: ${STATE.project.site.spanRule}-Foot Rule & Direction Changes`, 'NFPA 96 requires access openings at every change of direction and at cleaning intervals on horizontal runs. The fuzzy parser flags elbows with no door.']
        : ['MODULE 03 // ROOFTOP TERMINATION', 'Step 3: Upblast Fan Hinge & §4.6 Packet', 'Upblast fans need an approved hinge kit and hold-open retainer. The packet checklist confirms drawings, schematics and schedules are on premises.'];
    $('videoHudLabel').textContent = hud; $('briefingHeadline').textContent = head; $('briefingSubtext').textContent = sub;
    drawTutorialFrame();
    tut.anim = requestAnimationFrame(tutLoop);
  }
  function toggleTutorial() {
    tut.playing = !tut.playing;
    $('videoOverlay').classList.toggle('off', tut.playing);
    $('briefingActionText').textContent = tut.playing ? '⏸ Pause Briefing' : '▶ Resume Field Briefing';
    if (tut.playing) { playBeep(700, 'sine', 0.1); tutLoop(); } else cancelAnimationFrame(tut.anim);
  }
  function bindBriefing() {
    $('videoOverlay').addEventListener('click', toggleTutorial);
    $('videoProgressBar').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); tut.progress = clamp((e.clientX - r.left) / r.width * 100, 0, 99); drawTutorialFrame(); $('videoProgressFill').style.width = `${tut.progress}%`; });
    const hide = () => { $('briefingDock').classList.add('hidden'); if (tut.playing) toggleTutorial(); try { localStorage.setItem('nexus.briefing.hidden', '1'); } catch (e) { /* noop */ } };
    $('closeBriefingBtn').addEventListener('click', hide);
    $('skipTutorialBtn').addEventListener('click', hide);
    $('toggleTutorialBtn').addEventListener('click', () => {
      const dock = $('briefingDock'); dock.classList.toggle('hidden');
      if (!dock.classList.contains('hidden')) { try { localStorage.removeItem('nexus.briefing.hidden'); } catch (e) { /* noop */ } setTimeout(() => { resizeTutorial(); drawTutorialFrame(); }, 30); }
      else if (tut.playing) toggleTutorial();
    });
  }

  // ---------- Binder modal & exports ----------
  function openBinderModal() {
    A.runComplianceAudit();
    const p = STATE.project, a = STATE.audit;
    $('modalSiteName').textContent = (p.site.name || 'UNNAMED SITE').toUpperCase();
    $('modalAhj').textContent = `AHJ / MARSHAL: ${p.site.ahj || '—'}`;
    $('modalTech').textContent = `Technician: ${p.site.technician || '—'}`;
    $('modalDate').textContent = p.site.date || '';
    $('recordIdLabel').textContent = N.recordId();
    $('modalHash').textContent = N.projectHash();
    const dutyText = $('dutyLevelSelect').selectedOptions[0].text, fanText = $('fanTypeSelect').selectedOptions[0].text;
    $('modalDutyLabel').textContent = `${dutyText} // ${fanText}`;
    $('modalCadence').textContent = `Inspect: ${a.cadence}`;
    const badge = $('modalComplianceBadge');
    badge.className = a.violations.length ? 'hazard' : 'green';
    badge.style.cssText = 'font-size:14px;font-weight:800';
    badge.textContent = a.violations.length ? `⚠ ${a.violations.length} FINDING(S) · SCORE ${a.score}%` : `✓ NFPA 96 COMPLIANT AS RECORDED · ${a.score}%`;
    $('binderMapImage').src = C.exportPNG(false);

    $('modalApplianceBody').innerHTML = [
      `<tr><td class="cyan">HOOD</td><td style="color:#fff">${{ wall: 'Wall canopy', sbs: 'Side-by-side canopies', island: 'Island canopy' }[p.hood.type]} · ${p.hood.collars} collar(s)</td><td>${p.site.duty.toUpperCase()}</td><td>${fmtFt(p.hood.length)} × ${fmtFt(p.hood.depth)}</td></tr>`,
      ...p.appliances.map((x, i) => `<tr><td class="cyan">A${i + 1}</td><td style="color:#fff">${escapeHTML(x.name)}</td><td>${x.cls.replace('-', ' ').toUpperCase()}</td><td>${fmtFt(Number(x.width))}</td></tr>`)
    ].join('');

    $('modalScheduleBody').innerHTML = p.nodes.map(n => {
      const crit = n.type === 'fan' ? 'Roof termination §7.8' : n.type === 'hood' ? 'Collar §5.1' : (n.type === 'elbow90' || n.type === 'elbow45') ? (n.hasDoor ? 'Access at turn §7.4.1.1 ✓' : 'Access at turn REQUIRED') : n.type === 'horizontal' ? (Number(n.length) > p.site.spanRule && !n.hasDoor ? `Door required (>${p.site.spanRule} ft)` : 'Within interval §7.4.1.2') : n.type === 'vertical' ? (Number(n.length) > 12 && !n.hasDoor ? 'Riser access §7.4.3 REQUIRED' : 'Riser §7.4.3') : 'Listed access door';
      return `<tr><td class="cyan" style="font-weight:700">#${n.id}</td><td style="color:#fff">${escapeHTML(n.label)}</td><td>${n.type === 'hood' ? 'N/A' : fmtFt(Number(n.length) || 0)}</td><td class="${n.hasDoor ? 'green' : 'dim'}">${n.hasDoor ? 'INSTALLED' : 'NONE'}</td><td style="font-size:10px">${crit}</td><td style="font-size:10px" class="pink">${escapeHTML(n.note || '')}</td></tr>`;
    }).join('');

    $('modalFlags').innerHTML = a.rules.map(r => A.flagHTML({ t: r.title, ref: r.ref, d: r.desc, status: r.status })).join('') + a.flags.map(A.flagHTML).join('');
    $('modalAuditSummary').innerHTML = a.violations.length
      ? `<span class="hazard" style="font-weight:700">ATTENTION REQUIRED:</span> ${a.violations.map(escapeHTML).join('; ')}. Remediation and re-inspection required prior to sign-off. Inspection cadence: ${a.cadence}.`
      : `All duct segments, horizontal spans, change-of-direction access openings, hood coverage and rooftop termination conform to NFPA 96 as recorded. Drawing packet (§4.6) complete. Inspection cadence: ${a.cadence}. Field as-built ready for permanent binder archive and AHJ review.`;
    $('binderModal').classList.remove('hidden');
    playBeep(700, 'sine', 0.1);
  }

  async function saveOrShareFile(filename, dataOrBlob, mime, title) {
    // Native (Capacitor): write to cache and open share sheet. Web: Web Share with files, else download.
    const FS = plugin('Filesystem'), SH = plugin('Share');
    if (isNative() && FS && SH) {
      try {
        const base64 = typeof dataOrBlob === 'string' ? (dataOrBlob.startsWith('data:') ? dataOrBlob.split(',')[1] : btoa(unescape(encodeURIComponent(dataOrBlob)))) : await blobToBase64(dataOrBlob);
        const res = await FS.writeFile({ path: filename, data: base64, directory: 'CACHE' });
        await SH.share({ title, text: title, url: res.uri, dialogTitle: 'Share NEXUS packet' });
        return true;
      } catch (e) { if (e && /cancel/i.test(String(e.message || e))) return true; }
    }
    const blob = typeof dataOrBlob === 'string' ? await (await fetch(dataOrBlob.startsWith('data:') ? dataOrBlob : 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(dataOrBlob))).blob() : dataOrBlob;
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); return true; } catch (e) { if (e.name === 'AbortError') return true; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  }
  function blobToBase64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); }); }

  function slug() { return (STATE.project.site.name || 'nexus').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'nexus'; }

  function bindExports() {
    $('viewBinderBtn').addEventListener('click', openBinderModal);
    $('closeBinderBtn').addEventListener('click', () => $('binderModal').classList.add('hidden'));
    $('binderModal').addEventListener('click', (e) => { if (e.target === $('binderModal')) $('binderModal').classList.add('hidden'); });
    $('printBtn').addEventListener('click', () => window.print());
    $('exportPngBtn').addEventListener('click', async () => {
      A.runComplianceAudit();
      await saveOrShareFile(`NEXUS-asbuilt-${slug()}-${N.recordId()}.png`, C.exportPNG(true), 'image/png', 'NEXUS As-Built Schematic');
      showToast('As-built PNG exported with title block.');
    });
    $('exportJsonBtn').addEventListener('click', async () => {
      const json = JSON.stringify({ ...STATE.project, exportedAt: new Date().toISOString(), recordId: N.recordId(), hash: N.projectHash() }, null, 2);
      await saveOrShareFile(`${slug()}.nexus.json`, json, 'application/json', 'NEXUS Project');
      showToast('Project file exported.');
    });
    $('importJsonBtn').addEventListener('click', () => $('importFileInput').click());
    $('importFileInput').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data || !Array.isArray(data.nodes)) throw new Error('Not a NEXUS project');
        STATE.project = Object.assign(defaultProject(), data);
        hydrateDossier(); closeNodeEditor(); refresh(); C.fitView();
        showToast(`Opened ${f.name}.`);
      } catch (err) { showToast(`Could not open file: ${err.message}`, 'error'); }
      e.target.value = '';
    });
    const share = async () => {
      A.runComplianceAudit();
      const a = STATE.audit, p = STATE.project;
      const text = `NEXUS Duct As-Built — ${p.site.name}\nAHJ: ${p.site.ahj}\nRecord ${N.recordId()} · Score ${a.score}%\n${a.violations.length ? 'Findings:\n- ' + a.violations.join('\n- ') : 'NFPA 96 compliant as recorded.'}\nInspect: ${a.cadence}`;
      const SH = plugin('Share');
      try {
        if (isNative() && SH) await SH.share({ title: 'NEXUS Packet Summary', text, dialogTitle: 'Share packet summary' });
        else if (navigator.share) await navigator.share({ title: 'NEXUS Packet Summary', text });
        else { await navigator.clipboard.writeText(text); showToast('Summary copied to clipboard.'); }
      } catch (err) { if (!/abort|cancel/i.test(String(err))) showToast('Share unavailable.', 'warn'); }
    };
    $('shareBtn').addEventListener('click', share);
    $('modalShareBtn').addEventListener('click', share);
  }

  // ---------- Header / nav ----------
  function bindHeader() {
    $$('.wstep').forEach(b => b.addEventListener('click', () => setWizardStep(Number(b.dataset.step))));
    $('prevStepBtn').addEventListener('click', () => setWizardStep(STATE.currentStep - 1));
    $('nextStepBtn').addEventListener('click', () => { if (STATE.currentStep === 5) openBinderModal(); else setWizardStep(STATE.currentStep + 1); });
    $('viewWizardBtn').addEventListener('click', () => { setViewMode('wizard'); showToast('Field Wizard step mode.'); });
    $('viewProBtn').addEventListener('click', () => { setViewMode('pro'); showToast('Pro single-pane view.'); });
    $('toggleAudioBtn').addEventListener('click', () => {
      STATE.audioEnabled = !STATE.audioEnabled;
      $('audioStatusDot').classList.toggle('off', !STATE.audioEnabled);
      try { localStorage.setItem('nexus.audio', STATE.audioEnabled ? '1' : '0'); } catch (e) { /* noop */ }
      showToast(STATE.audioEnabled ? 'Audio cues enabled.' : 'Audio cues muted.');
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('binderModal').classList.add('hidden'); } });
  }

  function escapeHTML(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

  // ---------- Native shell integration ----------
  function initNative() {
    const App = plugin('App'), StatusBar = plugin('StatusBar'), Splash = plugin('SplashScreen');
    if (StatusBar) { StatusBar.setStyle({ style: 'DARK' }).catch(() => {}); StatusBar.setBackgroundColor({ color: '#070a0f' }).catch(() => {}); }
    if (App) {
      App.addListener('backButton', ({ canGoBack }) => {
        if (!$('binderModal').classList.contains('hidden')) { $('binderModal').classList.add('hidden'); return; }
        if (STATE.viewMode === 'wizard' && STATE.currentStep > 1) { setWizardStep(STATE.currentStep - 1); return; }
        if (!canGoBack) App.exitApp();
      });
    }
    if (Splash) setTimeout(() => Splash.hide().catch(() => {}), 150);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol) || isNative()) return;
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ---------- Boot ----------
  function init() {
    loadProject();
    try { STATE.audioEnabled = localStorage.getItem('nexus.audio') !== '0'; } catch (e) { /* noop */ }
    $('audioStatusDot').classList.toggle('off', !STATE.audioEnabled);
    try { if (localStorage.getItem('nexus.briefing.hidden') === '1') $('briefingDock').classList.add('hidden'); } catch (e) { /* noop */ }

    hydrateDossier();
    bindHeader(); bindDossier(); bindParser(); bindCanvasUI(); bindBriefing(); bindExports();
    setViewMode('wizard');
    setWizardStep(1);
    refresh({ save: false });
    C.startAnim();
    resizeTutorial(); drawTutorialFrame();
    window.addEventListener('resize', () => { C.resize(); resizeTutorial(); drawTutorialFrame(); });
    initNative();
    registerServiceWorker();
  }

  N.ui = { init, setWizardStep, setViewMode, executeParsing, openBinderModal, appendNode, refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
