/* js/maquette.js — éditeur visuel de la mise en page (espace prof)
   Les modifications se font sur un BROUILLON, puis sont enregistrées
   AUTOMATIQUEMENT une fraction de seconde après le dernier geste :
   les espaces élève/prof suivent tout de suite, sans bouton « Valider ». */
(function () {
  const App = (window.App = window.App || {});
  const M = (App.maquette = {});
  const T = App.theme;
  const esc = App.utils.escapeHtml;

  // Zones acceptées par type d'élément glissé
  const ACCEPTS = {
    module: ['columns', 'left', 'right', 'hidden'],
    pools: ['pools-top', 'pools-bottom'],
    row: ['rows']
  };
  const DRAG_THRESHOLD = 6;

  let root = null;
  let draft = null;
  let drag = null;
  let hoverZone = null;
  let applyTimer = null;
  let flashTimer = null;

  const $ = (sel) => root.querySelector(sel);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const modLabel = (m) => m.label || m.id;
  // Modules par ligne : 0 = tous sur une ligne (largeurs réglables), sinon 1 à 4
  const gridN = (v) => { v = Math.floor(Number(v)); return v >= 1 && v <= 4 ? v : 0; };
  const gridCols = (n, total) => (n ? Math.max(1, Math.min(n, total)) : 0);
  // Largeurs manuelles indépendantes : plateau (span) et réserves (poolSpan)
  const spanOf = (m) => Math.max(0.5, Number(m.span) || 1);
  const poolSpanOf = (m) => Math.max(0.5, Number(m.poolSpan) || 1);

  /* =========================================================
     BROUILLON
     ========================================================= */
  function fromState() {
    const c = App.state.config();
    return {
      title: c.title || '',
      subtitle: c.subtitle || '',
      theme: T.resolve(c.theme),
      poolsSide: c.layout && c.layout.poolsSide === 'bottom' ? 'bottom' : 'top',
      boardCols: gridN(c.layout && c.layout.boardCols),
      poolsCols: gridN(c.layout && c.layout.poolsCols),
      modules: clone(c.modules),
      rowIds: App.state.rows().map((r) => String(r.id))
    };
  }

  const getVal = (key) => (key.indexOf('theme.') === 0 ? draft.theme[key.slice(6)] : draft[key]);
  function setVal(key, value) {
    if (key.indexOf('theme.') === 0) draft.theme[key.slice(6)] = value;
    else draft[key] = value;
  }

  /* =========================================================
     MONTAGE
     ========================================================= */
  const options = (table) => Object.keys(table).map((k) =>
    '<option value="' + k + '">' + esc(table[k].label) + '</option>').join('');

  const gridOptions = () => '<option value="0">Tous sur une ligne (défaut)</option>' +
    [1, 2, 3, 4].map((n) => '<option value="' + n + '">' + n + ' par ligne</option>').join('');

  function controlsHtml() {
    return `
      <fieldset class="mq-group">
        <legend>Grille des modules</legend>
        <div class="field"><label for="mq-boardcols">Plateau : modules par ligne</label>
          <select id="mq-boardcols" data-mq="boardCols">${gridOptions()}</select></div>
        <div class="field"><label for="mq-poolscols">Réserves : modules par ligne</label>
          <select id="mq-poolscols" data-mq="poolsCols">${gridOptions()}</select></div>
        <p class="hint">Le <strong>plateau</strong> est la zone où l'élève dépose ses réponses (colonnes
          à associer) ; les <strong>réserves</strong> sont les bacs d'où il pioche les éléments.
          Dans les deux, tant que les modules tiennent sur une ligne, les largeurs se règlent
          à la main dans l'aperçu (séparateurs bleus) ; au-delà, la grille impose des colonnes égales.</p>
      </fieldset>

      <fieldset class="mq-group">
        <legend>Textes de l'écran</legend>
        <div class="field"><label for="mq-title">Titre</label>
          <input id="mq-title" type="text" data-mq="title"></div>
        <div class="field"><label for="mq-subtitle">Consigne</label>
          <input id="mq-subtitle" type="text" data-mq="subtitle"></div>
        <div class="inline">
          <div class="field"><label for="mq-titlesize">Taille du titre</label>
            <select id="mq-titlesize" data-mq="theme.titleSize">${options(T.TITLE_SIZES)}</select></div>
          <div class="field field-auto"><label for="mq-titlecolor">Couleur du titre</label>
            <span class="inline">
              <input id="mq-titlecolor" type="color" data-mq="theme.titleColor">
              <button type="button" class="btn link" data-mq-reset="titleColor">Auto</button>
            </span></div>
        </div>
        <div class="field"><label for="mq-subsize">Taille de la consigne</label>
          <select id="mq-subsize" data-mq="theme.subtitleSize">${options(T.SUBTITLE_SIZES)}</select></div>
      </fieldset>

      <fieldset class="mq-group">
        <legend>Couleurs</legend>
        <div class="inline inline-colors">
          <div class="field field-auto"><label for="mq-primary">Principale</label>
            <input id="mq-primary" type="color" data-mq="theme.primary"></div>
          <div class="field field-auto"><label for="mq-bg">Fond</label>
            <input id="mq-bg" type="color" data-mq="theme.bg"></div>
          <div class="field field-auto"><label for="mq-ink">Texte</label>
            <input id="mq-ink" type="color" data-mq="theme.ink"></div>
        </div>
      </fieldset>

      <fieldset class="mq-group">
        <legend>Style général</legend>
        <div class="field"><label for="mq-font">Police</label>
          <select id="mq-font" data-mq="theme.font">${options(T.FONTS)}</select></div>
        <div class="inline">
          <div class="field"><label for="mq-scale">Taille du texte</label>
            <select id="mq-scale" data-mq="theme.scale">${options(T.SCALES)}</select></div>
          <div class="field"><label for="mq-radius">Coins</label>
            <select id="mq-radius" data-mq="theme.radius">${options(T.RADII)}</select></div>
        </div>
      </fieldset>`;
  }

  M.mount = function (container) {
    root = container;
    root.innerHTML = `
      <div class="panel-head">
        <h2>Maquette de l'exercice</h2>
        <div class="tools">
          <button type="button" class="btn small" id="mq-reset-style">Style par défaut</button>
          <span id="mq-status" class="mq-status" role="status" aria-live="polite"></span>
        </div>
      </div>
      <p class="hint">
        Glissez les éléments dans l'aperçu pour organiser l'écran. Chaque réglage est
        <strong>enregistré automatiquement</strong> (indicateur en haut à droite) et aussitôt
        visible dans les espaces élève et prof.
      </p>
      <div class="mq-layout">
        <div class="mq-preview-col" id="mq-preview"></div>
        <div class="mq-controls">${controlsHtml()}</div>
      </div>`;

    draft = fromState();
    syncControls();
    renderPreview();
    setStatus('', false);

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('input', onFieldInput);
    root.addEventListener('change', onFieldInput);
    root.addEventListener('click', onClick);

    App.state.onChange(() => {
      if (applyTimer) { clearTimeout(applyTimer); applyTimer = null; }
      draft = fromState();
      syncControls();
      renderPreview();
      setStatus('', false);
    });
  };

  function syncControls() {
    root.querySelectorAll('[data-mq]').forEach((el) => {
      const key = el.dataset.mq;
      let v = getVal(key);
      if (key === 'theme.titleColor') v = v || draft.theme.ink;
      if (el.value !== v) el.value = v;
    });
  }

  /* =========================================================
     ENREGISTREMENT AUTOMATIQUE
     ========================================================= */
  function setStatus(text, busy) {
    const el = root && root.querySelector('#mq-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-busy', !!busy);
  }

  /* Programme l'application du brouillon après une courte pause :
   pendant le rendu en direct (glisser, redimensionner) rien n'est
   réécrit, c'est le dernier état qui fait foi. */
  function scheduleApply() {
    setStatus('Enregistrement…', true);
    clearTimeout(applyTimer);
    applyTimer = setTimeout(runApply, 600);
  }

  function runApply() {
    applyTimer = null;
    if (!applyDraft(true)) { setStatus('', false); return; }
    setStatus('✓ Enregistré', false);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      if (applyTimer == null) setStatus('', false);
    }, 2500);
  }

  function onFieldInput(e) {
    const el = e.target.closest('[data-mq]');
    if (!el) return;
    const key = el.dataset.mq;
    setVal(key, (key === 'boardCols' || key === 'poolsCols') ? gridN(el.value) : el.value);
    renderPreview();
    scheduleApply();
  }

  function onClick(e) {
    const reset = e.target.closest('[data-mq-reset]');
    if (reset) {
      draft.theme[reset.dataset.mqReset] = '';
      syncControls(); renderPreview(); scheduleApply();
      return;
    }
    const btn = e.target.closest('button[id]');
    if (!btn) return;
    if (btn.id === 'mq-reset-style') {
      draft.theme = T.resolve({});
      syncControls(); renderPreview(); scheduleApply();
    }
  }

  /* Applique le brouillon aux données officielles ; renvoie false si
     la disposition n'est pas applicable (mode silencieux : sans alerte). */
  function applyDraft(silent) {
    if (!draft.modules.some((m) => m.role === 'associate')) {
      if (!silent) alert('Il faut au moins un module « à associer » dans le plateau.');
      return false;
    }
    const c = clone(App.state.config());
    c.title = draft.title.trim();
    c.subtitle = draft.subtitle.trim();
    c.theme = T.resolve(draft.theme);
    c.layout = Object.assign({}, c.layout, {
      poolsSide: draft.poolsSide, boardCols: draft.boardCols, poolsCols: draft.poolsCols
    });
    c.modules = clone(draft.modules);
    App.state.updateConfig(c);
    App.state.reorderRows(draft.rowIds);
    return true;
  }

  /* =========================================================
     APERÇU
     ========================================================= */
  const kindLabel = (m) => {
    const k = App.schema.kindInfo(m.kind);
    return k ? k.label : m.kind;
  };

  const SPANS = [[0.75, 'Étroite'], [1, 'Normale'], [1.5, 'Large'], [2, 'Très large']];

  const RESIZER = '<div class="mq-resizer" title=""></div>';

  function moduleChip(m, showWidth) {
    const span = Number(m.span) || 1;
    const style = showWidth
      ? ' style="flex-grow:' + span + ';flex-basis:0;min-width:0"' : '';
    const badge = showWidth ? '' : '<span class="badge">' + esc(kindLabel(m)) + '</span>';
    return '<div class="mq-chip mq-chip-module' + (m.role === 'associate' ? ' is-assoc' : '') +
      '" data-drag-kind="module" data-drag-id="' + esc(m.id) + '" title="' + esc(m.id) + '"' + style + '>' +
      '<span class="mq-grip" aria-hidden="true">⣿</span>' +
      '<span class="mq-name">' + esc(modLabel(m)) + '</span>' +
      badge + '</div>';
  }

  function zoneHtml(name, title, inner, cls, itemsAttr) {
    return '<div class="mq-zone ' + (cls || '') + '" data-zone="' + name + '">' +
      '<div class="mq-zone-label">' + title + '</div>' +
      '<div class="mq-zone-items"' + (itemsAttr || '') + '>' + (inner || '<span class="mq-empty">Déposez ici</span>') + '</div>' +
      '</div>';
  }

  function rowChips() {
    const rows = App.state.rows();
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    const first = draft.modules.find((m) => m.role === 'associate');
    const type = first && App.schema.Types[first.kind];
    return draft.rowIds.map((id, i) => {
      const r = byId.get(id);
      let s = '';
      if (r && type && r.cells[first.id] != null) s = String(type.summary(r.cells[first.id]) || '');
      if (s.length > 22) s = s.slice(0, 22) + '…';
      return '<div class="mq-chip mq-chip-row" data-drag-kind="row" data-drag-id="' + esc(id) + '">' +
        '<span class="mq-grip" aria-hidden="true">⠿</span>' + (i + 1) + ' · ' + esc(s || '(vide)') + '</div>';
    }).join('');
  }

  function renderPreview() {
    const t = T.resolve(draft.theme);
    const applied = T.scaleValue(T.resolve(App.state.config().theme).scale);
    const pv = T.scaleValue(t.scale) / applied;
    const vars = T.vars(t);
    const style = Object.keys(vars).map((k) => k + ':' + vars[k]).join(';') + ';--pv:' + pv;

    const assoc = draft.modules.filter((m) => m.role === 'associate');
    const inZone = (z) => draft.modules.filter((m) => m.role === 'informative' && m.zone === z);

    // Réserves : mini-grille montrant la disposition choisie.
    // Comme pour le plateau : si la grille tient de toute façon sur une ligne,
    // on garde les largeurs manuelles et des séparateurs de redimensionnement.
    const pcDraft = gridCols(draft.poolsCols, assoc.length);
    const pc = (pcDraft && pcDraft >= assoc.length) ? 0 : pcDraft;
    const poolsOneLine = !pc;
    const poolParts = [];
    assoc.forEach((m, i) => {
      if (i && poolsOneLine) poolParts.push('9px');
      poolParts.push('minmax(0,' + poolSpanOf(m) + 'fr)');
    });
    const poolsTpl = pc ? 'repeat(' + pc + ',minmax(0,1fr))' : poolParts.join(' ');
    const poolsChip = '<div class="mq-chip mq-chip-pools" data-drag-kind="pools" data-drag-id="pools">' +
      '<span class="mq-grip" aria-hidden="true">⠿</span>' +
      '<div class="mq-pools-body"><div class="mq-pools-title">Réserves</div>' +
      '<div class="mq-mini-pools" style="grid-template-columns:' + poolsTpl + '">' +
      assoc.map((m) => '<span class="mq-mini" data-span-id="' + esc(m.id) + '" title="' + esc(m.id) + '">' + esc(modLabel(m)) + '</span>').join(poolsOneLine ? RESIZER : '') +
      '</div></div></div>';

    // Plateau : grille de N colonnes égales, ou une ligne avec séparateurs de largeur
    // Si la grille tient de toute façon sur une ligne (N >= nb de modules à associer),
    // on garde les largeurs manuelles et les séparateurs : les deux réglages donnent
    // le même rendu, mais un seul laisse le redimensionnement possible.
    const bcDraft = gridCols(draft.boardCols, assoc.length);
    const bc = (bcDraft && bcDraft >= assoc.length) ? 0 : bcDraft;
    const boardChips = assoc.map((m) => moduleChip(m, true)).join(bc ? '' : RESIZER);
    const boardAttr = bc ? ' style="display:grid;grid-template-columns:repeat(' + bc + ',minmax(0,1fr))"' : '';
    const poolsZone = (name, side) => zoneHtml(name, 'Réserves', draft.poolsSide === side ? poolsChip : '', 'mq-pools');

    $('#mq-preview').innerHTML =
      '<div class="mq-screen" style="' + esc(style) + '">' +
        '<div class="mq-title">' + esc(draft.title || 'Titre') + '</div>' +
        '<div class="mq-subtitle">' + esc(draft.subtitle) + '</div>' +
        poolsZone('pools-top', 'top') +
        '<div class="mq-main">' +
          zoneHtml('left', 'Panneau gauche', inZone('left').map(moduleChip).join(''), 'mq-side') +
          zoneHtml('columns', 'Plateau — colonnes à associer (dans l\'ordre)',
            boardChips, 'mq-board', boardAttr) +
          zoneHtml('right', 'Panneau droit', inZone('right').map(moduleChip).join(''), 'mq-side') +
        '</div>' +
        poolsZone('pools-bottom', 'bottom') +
      '</div>' +
      zoneHtml('hidden', 'Modules masqués (non affichés à l\'élève)', inZone('hidden').map(moduleChip).join(''), 'mq-hidden') +
      zoneHtml('rows', 'Ordre des lignes', rowChips(), 'mq-rows');
  }

  /* =========================================================
     GLISSER-DÉPOSER (souris et tactile)
     ========================================================= */
  function onPointerDown(e) {
    if (e.target.closest('.mq-resizer')) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startResize(e);
      return;
    }
    const chip = e.target.closest('.mq-chip');
    if (!chip || !root.contains(chip) || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = {
      kind: chip.dataset.dragKind, id: chip.dataset.dragId, chip,
      startX: e.clientX, startY: e.clientY, offX: 0, offY: 0,
      dragging: false, ghost: null
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', endDrag);
  }

  function beginDrag(e) {
    const rect = drag.chip.getBoundingClientRect();
    const ghost = drag.chip.cloneNode(true);
    ghost.classList.add('mq-ghost');
    ghost.style.width = rect.width + 'px';
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.offX = drag.startX - rect.left;
    drag.offY = drag.startY - rect.top;
    drag.dragging = true;
    drag.chip.classList.add('dragging');
  }

  function zoneAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const z = el && el.closest('.mq-zone');
    return z && root.contains(z) && ACCEPTS[drag.kind].includes(z.dataset.zone) ? z : null;
  }

  function onMove(e) {
    if (!drag) return;
    if (!drag.dragging) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
      beginDrag(e);
    }
    drag.ghost.style.transform =
      'translate(' + (e.clientX - drag.offX) + 'px,' + (e.clientY - drag.offY) + 'px)';
    const z = zoneAt(e.clientX, e.clientY);
    if (z !== hoverZone) {
      if (hoverZone) hoverZone.classList.remove('drop-hover');
      hoverZone = z;
      if (z) z.classList.add('drop-hover');
    }
  }

  function onUp(e) {
    const d = drag;
    const zone = hoverZone;
    endDrag();
    if (!d || !d.dragging || !zone) return;
    drop(d, zone.dataset.zone, insertIndex(zone, d, e.clientX, e.clientY));
  }

  let rz = null;

  function startResize(e) {
    const sep = e.target.closest('.mq-resizer');
    if (!sep) return;
    const left = sep.previousElementSibling;
    const right = sep.nextElementSibling;
    if (!left || !right || left.classList.contains('mq-resizer')) return;
    const modulesOf = (el) => draft.modules.find((x) =>
      x.id === (el.dataset.dragId || el.dataset.spanId));
    const mods = [left, right].map(modulesOf);
    if (mods.some((m) => !m)) return;
    const isPools = sep.parentNode.classList &&
      sep.parentNode.classList.contains('mq-mini-pools');
    const wKey = isPools ? 'poolSpan' : 'span';
    const widths = mods.map((m) => Math.max(0.5, Number(m[wKey]) || 1));
    const lr = left.getBoundingClientRect();
    const rr = right.getBoundingClientRect();
    rz = {
      chips: [left, right], mods, wKey,
      spans: widths,
      pxPerSpan: (lr.width + rr.width) / (widths[0] + widths[1]),
      grid: isPools ? sep.parentNode : null,
      startX: e.clientX
    };
    window.addEventListener('pointermove', onResizeMove);
    window.addEventListener('pointerup', onResizeEnd);
    window.addEventListener('pointercancel', onResizeEnd);
    e.preventDefault();
  }

  function onResizeMove(e) {
    if (!rz) return;
    const clampSpan = (v) => Math.min(3, Math.max(0.5, v));
    const pair = rz.spans[0] + rz.spans[1];
    let delta = (e.clientX - rz.startX) / rz.pxPerSpan;
    let a = clampSpan(rz.spans[0] + delta);
    a = Math.min(a, Math.max(0.5, pair - 0.5));
    let b = clampSpan(pair - a);
    rz.mods[0][rz.wKey] = a;
    rz.mods[1][rz.wKey] = b;
    if (rz.wKey === 'span') {
      if (rz.chips[0]) rz.chips[0].style.flexGrow = a;
      if (rz.chips[1]) rz.chips[1].style.flexGrow = b;
    }
    if (rz.grid) syncMiniTemplate(rz.grid);
  }

  /* Reconstruit le gabarit de la mini-grille des réserves après un changement de largeur. */
  function syncMiniTemplate(container) {
    container.style.gridTemplateColumns = [...container.children].map((el) => {
      if (el.classList.contains('mq-resizer')) return '9px';
      const m = draft.modules.find((x) => x.id === el.dataset.spanId);
      return 'minmax(0,' + poolSpanOf(m || {}) + 'fr)';
    }).join(' ');
  }

  function onResizeEnd() {
    window.removeEventListener('pointermove', onResizeMove);
    window.removeEventListener('pointerup', onResizeEnd);
    window.removeEventListener('pointercancel', onResizeEnd);
    rz = null;
    scheduleApply();
  }

  function endDrag() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', endDrag);
    if (hoverZone) { hoverZone.classList.remove('drop-hover'); hoverZone = null; }
    if (drag) {
      drag.chip.classList.remove('dragging');
      if (drag.ghost) drag.ghost.remove();
    }
    drag = null;
  }

  /** Position d'insertion parmi les éléments de la zone (hors élément glissé). */
  function insertIndex(zoneEl, d, x, y) {
    const chips = [...zoneEl.querySelectorAll('.mq-chip')].filter((c) => c !== d.chip);
    for (let i = 0; i < chips.length; i++) {
      const r = chips[i].getBoundingClientRect();
      if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) return i;
    }
    return chips.length;
  }

  function drop(d, zone, index) {
    if (d.kind === 'pools') draft.poolsSide = zone === 'pools-bottom' ? 'bottom' : 'top';
    else if (d.kind === 'row') moveRow(d.id, index);
    else if (d.kind === 'module') moveModule(d.id, zone, index);
    renderPreview();
    scheduleApply();
  }

  function moveRow(id, index) {
    const ids = draft.rowIds.filter((x) => x !== id);
    ids.splice(index, 0, id);
    draft.rowIds = ids;
  }

  function moveModule(id, zone, index) {
    const m = draft.modules.find((x) => x.id === id);
    if (!m) return;
    const toColumns = zone === 'columns';

    if (m.role === 'associate' && !toColumns &&
        draft.modules.filter((x) => x.role === 'associate').length === 1) {
      alert('Il faut garder au moins un module « à associer » dans le plateau.');
      return;
    }
    if (toColumns && m.role !== 'associate') {
      const type = App.schema.Types[m.kind];
      const empty = App.state.rows().filter((r) => !(r.cells[m.id] != null && type.validate(r.cells[m.id]))).length;
      if (empty > 0 && !confirm('« ' + modLabel(m) + ' » est vide dans ' + empty +
          ' ligne(s). Dans le plateau, chaque ligne doit avoir un contenu. Continuer ?')) return;
    }

    draft.modules = draft.modules.filter((x) => x !== m);
    if (toColumns) { m.role = 'associate'; delete m.zone; }
    else { m.role = 'informative'; m.zone = zone; }

    const members = draft.modules.filter((x) =>
      toColumns ? x.role === 'associate' : (x.role === 'informative' && x.zone === zone));
    let at;
    if (!members.length) at = draft.modules.length;
    else if (index < members.length) at = draft.modules.indexOf(members[index]);
    else at = draft.modules.indexOf(members[members.length - 1]) + 1;
    draft.modules.splice(at, 0, m);
  }

  M.draft = () => draft;
})();
