/* js/student.js */
(function () {
  const App = window.App;
  const S = (App.student = {});
  const esc = App.utils.escapeHtml;

  // Types d'items qui n'ont pas besoin d'être « ouverts » pour valider un verrou
  const NO_OPEN_KINDS = new Set(['text']);
  const DRAG_THRESHOLD = 10;

  let root = null;
  let board = null;
  let drag = null;
  let viewed = {};        // { [moduleId]: Set(keys) }
  let moduleState = {};   // { [moduleId]: { locked, deps } }
  let expandedModuleId = null;
  let hoverEl = null;
  let moveFrame = 0;
  let lastMove = null;

  const $ = (sel) => root.querySelector(sel);
  const cfg = () => App.state.config();
  const assocMods = () => cfg().modules.filter((m) => m.role === 'associate');
  const infoMods = () => cfg().modules.filter((m) => m.role === 'informative');
  const modLabel = (m) => m.label || m.id;
  const cssId = (id) => CSS.escape(String(id));
  // Largeurs manuelles indépendantes : plateau (span) et réserves (poolSpan)
  const colsTpl = (mods, wKey) => mods.map((m) =>
    'minmax(0,' + (Math.max(0.5, Number(m[wKey]) || 1)) + 'fr)').join(' ');

  // Modules par ligne : 0 = tous sur une ligne (largeurs réglables), sinon 1 à 4
  const gridN = (v) => { v = Math.floor(Number(v)); return v >= 1 && v <= 4 ? v : 0; };

  /** Plan de grille : nombre de colonnes, modèle CSS et nombre de lignes occupées par module.
   *  Avec spanMode (plateau) : si la grille tient de toute façon sur une ligne,
   *  on revient aux largeurs manuelles (span) pour rester cohérent avec l'aperçu prof. */
  function gridPlan(mods, perLine, wKey) {
    const n = gridN(perLine);
    if (!n) return { cols: mods.length || 1, tpl: colsTpl(mods, wKey), lines: 1 };
    const cols = Math.max(1, Math.min(n, mods.length));
    if (wKey && cols >= mods.length) {
      return { cols: mods.length || 1, tpl: colsTpl(mods, wKey), lines: 1 };
    }
    return { cols, tpl: 'repeat(' + cols + ',minmax(0,1fr))', lines: Math.max(1, Math.ceil(mods.length / cols)) };
  }

  // Découpe une liste en lignes de n éléments (mode grille « N par ligne »).
  // Chaque ligne garde les largeurs réglées (span / poolSpan) au lieu de
  // colonnes uniformes.
  const chunk = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };
  const groupTpl = (group, wKey) => group.map((m) =>
    'minmax(0,' + (Math.max(0.5, Number(m[wKey]) || 1)) + 'fr)').join(' ');

  /* =========================================================
     MONTAGE
     ========================================================= */
  S.mount = function (container) {
    root = container;
    root.innerHTML = `
    <div class="student view-student-layout">
      <div class="student-toolbar">
        <p class="instructions" id="s-instructions"></p>
        <div class="tools">
          <button type="button" class="btn" id="s-save" disabled>Enregistrer mes réponses</button>
          <button type="button" class="btn" id="s-reset">Recommencer</button>
        </div>
      </div>
      <div id="s-pools-zone"></div>
      <div class="student-main-row">
        <aside class="info-sidebar" id="s-info-left" hidden></aside>
        <div class="board" id="board"></div>
        <aside class="info-sidebar" id="s-info-right" hidden></aside>
      </div>
      <p class="empty-state" id="s-empty" hidden>
        Aucune donnée pour le moment. Passez dans l'<strong>espace prof</strong>
        pour créer des associations.
      </p>
    </div>`;
    bind();
    S.reset();
    App.state.onChange(() => S.reset());
  };

  function bind() {
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('dragstart', (e) => {
      const itemEl = e.target.closest('.item');
      if (itemEl) e.preventDefault();
});
    root.addEventListener('click', onModuleExpandClick);
    $('#s-reset').addEventListener('click', () => S.reset());
    $('#s-save').addEventListener('click', onSave);

    // L'écouteur est sur document : root n'a jamais le focus clavier
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && expandedModuleId) closeExpandedModule();
    });

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(balancePools, 150);
    });
  }

  /* =========================================================
     RESET / CONSTRUCTION DU PLATEAU
     ========================================================= */
  S.reset = function () {
    const c = cfg();
    const mods = assocMods();

    $('#s-instructions').textContent = c.subtitle || '';
    $('.student').classList.toggle('pools-bottom', !!(c.layout && c.layout.poolsSide === 'bottom'));

    const zone = $('#s-pools-zone');
    zone.classList.remove('has-expanded-module');
    const poolPlan = gridPlan(mods, c.layout && c.layout.poolsCols, 'poolSpan');
    const colHtml = (m) => {
      const poolStyle = [
        m.poolCols ? '--pool-cols:' + Number(m.poolCols) : '',
        m.poolColor ? '--pool-color:' + esc(m.poolColor) : ''
      ].filter(Boolean).join(';');
      return `
        <div class="pool-col">
          <h3 class="pool-title">
            <button type="button" class="module-nav" data-nav-dir="prev"
              aria-label="Module précédent" title="Module précédent">‹</button>
            <span>${esc(modLabel(m))}</span>
            <button type="button" class="module-nav" data-nav-dir="next"
              aria-label="Module suivant" title="Module suivant">›</button>
            <button type="button" class="module-preview-open"
              data-preview-module="${esc(m.id)}"
              aria-label="Agrandir le module ${esc(modLabel(m))}"
              aria-pressed="false" title="Agrandir le module">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </h3>
          <div class="pool${m.poolCols ? ' is-gridded' : ''}${m.poolColor ? ' has-color' : ''}" data-pool-module="${esc(m.id)}" id="pool-${esc(m.id)}"${poolStyle ? ' style="' + poolStyle + '"' : ''}></div>
        </div>`;
    };
    const poolsInner = poolPlan.lines > 1
      ? chunk(mods, poolPlan.cols).map((g) =>
          '<div class="pools-line" style="grid-template-columns:' + groupTpl(g, 'poolSpan') + '">' +
          g.map((m) => colHtml(m)).join('') + '</div>').join('')
      : mods.map((m) => colHtml(m)).join('');
    zone.innerHTML =
     '<div class="pools' + (poolPlan.lines > 1 ? ' pools-rows' : '') +
      '" style="--cols:' + poolPlan.cols + (poolPlan.lines > 1 ? '' : ';--cols-tpl:' + poolPlan.tpl) + '">' +
      poolsInner + '</div>';
    expandedModuleId = null;

    viewed = {};
    mods.forEach((m) => { viewed[m.id] = new Set(); });
    buildBoard();
    renderInfoSidebars();
    render();
  };

  function buildBoard() {
    const mods = assocMods();
    const rows = App.state.rows();
    board = { keys: {}, items: {}, placement: {}, slots: {}, placed: 0, total: rows.length * mods.length };

    mods.forEach((m) => {
      board.keys[m.id] = [];
      board.slots[m.id] = new Array(rows.length).fill(null);
    });
    rows.forEach((r) => {
      mods.forEach((m) => {
        const key = m.id + '_' + r.id;
        board.items[key] = { key, moduleId: m.id, kind: m.kind, rowId: r.id, value: r.cells[m.id] };
        board.keys[m.id].push(key);
        board.placement[key] = null;
        if (NO_OPEN_KINDS.has(m.kind)) viewed[m.id].add(key);
      });
    });
    mods.forEach((m) => { board.keys[m.id] = App.utils.shuffle(board.keys[m.id]); });
  }

  /* Placement : seule fonction qui modifie placement / slots / compteur */
  function setPlacement(key, row) {
    const item = board.items[key];
    const slots = board.slots[item.moduleId];
    const old = board.placement[key];
    if (old !== null && slots[old] === key) slots[old] = null;
    if (old === null && row !== null) board.placed++;
    else if (old !== null && row === null) board.placed--;
    board.placement[key] = row;
    if (row !== null) slots[row] = key;
  }

  const occupantOf = (moduleId, row) => board.slots[moduleId][row] || null;

  /* =========================================================
     VERROU (unlockAfter)
     ========================================================= */
  function moduleLock(m, mods) {
    if (!m.unlockAfter || !m.unlockAfter.length) return { locked: false };
    const deps = m.unlockAfter.map((id) => {
      const dep = mods.find((x) => x.id === id);
      if (!dep) return null;
      return { id, label: modLabel(dep), total: board.keys[id].length, seen: viewed[id].size };
    }).filter(Boolean);
    return { locked: deps.some((d) => d.seen < d.total), deps };
  }

  /* =========================================================
     RENDU
     ========================================================= */
  const slotHint = (m) => '<span class="slot-hint">' +
    esc(modLabel(m)) + (moduleState[m.id] && moduleState[m.id].locked ? ' verrouillé' : '') + '</span>';

  const itemHtml = (key) => {
    const item = board.items[key];
    return App.schema.Types[item.kind].render(item.value, { key, module: item.moduleId });
  };

  function poolHtml(moduleId) {
    return board.keys[moduleId].filter((k) => board.placement[k] === null).map(itemHtml).join('');
  }

  function render() {
    const rows = App.state.rows();
    const mods = assocMods();
    const hasData = rows.length > 0;

    $('#s-empty').hidden = hasData;
    $('#s-pools-zone').style.display = hasData ? '' : 'none';
    updateSaveButton();
    if (!hasData) { $('#board').innerHTML = ''; return; }

    mods.forEach((m) => { moduleState[m.id] = moduleLock(m, mods); });

    // Le module agrandi vient de se reverrouiller : on referme
    if (expandedModuleId && moduleState[expandedModuleId] && moduleState[expandedModuleId].locked) {
      closeExpandedModule();
    }

    mods.forEach((m) => {
      const pool = $('#pool-' + cssId(m.id));
      if (!pool) return;
      const lock = moduleState[m.id];
      if (lock.locked) {
        const progress = lock.deps.map((d) => d.seen + '/' + d.total).join(', ');
        pool.innerHTML = '<p class="hint" role="status" aria-live="polite">' +
          'Ouvrez d’abord les éléments requis (' + progress + ').</p>';
      } else {
        pool.innerHTML = poolHtml(m.id);
      }
    });
    updatePreviewButtons();

    const boardPlan = gridPlan(mods, cfg().layout && cfg().layout.boardCols, 'span');
    const multi = boardPlan.lines > 1;
    const slotHtml = (m, r) => {
      const k = occupantOf(m.id, r);
      return '<div class="slot" data-slot-module="' + esc(m.id) + '" data-row="' + r + '">' +
        (k ? itemHtml(k) : slotHint(m)) + '</div>';
    };
    let html = '';
    for (let r = 0; r < rows.length; r++) {
      html += '<div class="row' + (multi ? ' row-multiline' : '') + '" data-row="' + r + '">' +
        '<div class="row-index">' + (r + 1) + '</div>';
      if (multi) {
        html += '<div class="row-lines">' +
          chunk(mods, boardPlan.cols).map((g) =>
            '<div class="row-line" style="grid-template-columns:' + groupTpl(g, 'span') + '">' +
            g.map((m) => slotHtml(m, r)).join('') + '</div>').join('') +
          '</div>';
      } else {
        mods.forEach((m) => { html += slotHtml(m, r); });
      }
      html += '</div>';
    }
    const boardEl = $('#board');
    boardEl.style.setProperty('--cols', String(boardPlan.cols));
    boardEl.style.setProperty('--cols-tpl', boardPlan.tpl);
    boardEl.innerHTML = html;
    balancePools();
  }

  function renderInfoSidebars() {
    const rows = App.state.rows();
    const infos = infoMods();

    [['left', $('#s-info-left')], ['right', $('#s-info-right')]].forEach(([side, el]) => {
      const html = infos.filter((m) => m.zone === side).map((m) => {
        const type = App.schema.Types[m.kind];
        if (!type) return '';
        const items = rows
          .filter((r) => r.cells[m.id] != null && type.validate(r.cells[m.id]))
          .map((r) => type.render(r.cells[m.id], { key: 'info_' + m.id + '_' + r.id, static: true }));
        return items.length
          ? '<div class="info-module"><h4>' + esc(modLabel(m)) + '</h4>' + items.join('') + '</div>'
          : '';
      }).join('');
      el.innerHTML = html;
      el.hidden = !html;
    });
  }

  function updateSaveButton() {
    $('#s-save').disabled = !(board && board.total > 0 && board.placed === board.total);
  }

  /* =========================================================
     AGRANDISSEMENT ANIMÉ D'UN MODULE (bouton œil)
     ========================================================= */
  function onModuleExpandClick(e) {
    const nav = e.target.closest('.module-nav');
    if (nav) {
      if (!nav.disabled) navigateExpanded(nav.dataset.navDir === 'prev' ? -1 : 1);
      return;
    }
    const button = e.target.closest('.module-preview-open');
    if (!button || button.disabled) return;
    const id = button.dataset.previewModule;
    if (expandedModuleId === id) closeExpandedModule();
    else expandModule(id);
  }

  /* Navigation ‹ › entre les modules dans la vue agrandie ;
     on saute les modules verrouillés et on boucle. */
  function navigateExpanded(dir) {
    const mods = assocMods();
    if (!expandedModuleId || mods.length < 2) return;
    const i = mods.findIndex((m) => m.id === expandedModuleId);
    for (let step = 1; step <= mods.length; step++) {
      const cand = mods[((i + dir * step) % mods.length + mods.length) % mods.length];
      if (moduleState[cand.id] && !moduleState[cand.id].locked) {
        expandModule(cand.id);
        return;
      }
    }
  }

  function animateRect(el, from, to) {
    if (!el.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const sx = to.width ? from.width / to.width : 1;
    const sy = to.height ? from.height / to.height : 1;
    el.animate([
      { transformOrigin: 'top left',
        transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})` },
      { transformOrigin: 'top left', transform: 'none' }
    ], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  function toggleExpanded(col, expand) {
    const zone = $('#s-pools-zone');
    const before = col.getBoundingClientRect();
    col.classList.toggle('is-expanded', expand);
    zone.classList.toggle('has-expanded-module', expand);
    if (expand) col.style.maxHeight = '';
    animateRect(col, before, col.getBoundingClientRect());
    updatePreviewButtons();
  }

  function expandModule(moduleId) {
    const btn = root.querySelector('[data-preview-module="' + cssId(moduleId) + '"]');
    const col = btn && btn.closest('.pool-col');
    if (!col) return;
    if (expandedModuleId) closeExpandedModule();
    expandedModuleId = moduleId;
    toggleExpanded(col, true);
    updatePreviewButtons();
  }

  function closeExpandedModule() {
    const col = $('#s-pools-zone .pool-col.is-expanded');
    expandedModuleId = null;
    if (col) toggleExpanded(col, false);
    updatePreviewButtons();
  }

  function updatePreviewButtons() {
    root.querySelectorAll('.module-nav').forEach((nav) => {
      nav.disabled = expandedModuleId ? false : true;
    });
    root.querySelectorAll('.module-preview-open').forEach((button) => {
      const id = button.dataset.previewModule;
      const locked = !!(moduleState[id] && moduleState[id].locked);
      const active = id === expandedModuleId;
      button.disabled = locked;
      button.setAttribute('aria-pressed', String(active));
      button.title = locked ? 'Module verrouillé' : (active ? 'Réduire le module' : 'Agrandir le module');
    });
  }

  function balancePools() {
    const zone = $('#s-pools-zone');
    zone.classList.toggle('has-expanded-module', !!expandedModuleId);
    const col = zone.querySelector('.pool-col.is-expanded');
    if (col) col.style.maxHeight = Math.max(180, Math.floor(zone.clientHeight - 8)) + 'px';
    else zone.querySelectorAll('.pool-col').forEach((c) => { c.style.maxHeight = ''; });
  }

  /* =========================================================
     DRAG & DROP
     ========================================================= */
  function onPointerDown(e) {
    const itemEl = e.target.closest('.item');
    if (!itemEl || !root.contains(itemEl) || itemEl.closest('.info-sidebar')) return;
    if (e.button !== 0 || drag) return;

    const key = itemEl.dataset.itemKey;
    const item = board && board.items[key];
    if (!item) return;
    const lock = moduleState[item.moduleId];
    if (lock && lock.locked) return;

    e.preventDefault();
    drag = {
      key, itemEl, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      offsetX: 0, offsetY: 0, dragging: false, ghost: null
    };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
  }

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;

  if (!drag.dragging) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
    startVisualDrag(e);
  }

  lastMove = { x: e.clientX, y: e.clientY };

  // Déplacement du fantôme et détection de la cible :
  // une seule mise à jour par frame.
  if (!moveFrame) {
    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0;

      if (!drag || !drag.dragging || !lastMove) return;

      moveGhost(lastMove);
      highlight(lastMove.x, lastMove.y);
    });
  }
}

function startVisualDrag(e) {
  const rect = drag.itemEl.getBoundingClientRect();

  const ghost = drag.itemEl.cloneNode(true);
  ghost.classList.add('item-ghost');

  // La miniature ne doit jamais intercepter la souris :
  // sinon, la case de dépôt ne peut plus être détectée.
  ghost.style.pointerEvents = 'none';

  const img = ghost.querySelector('img');
  if (img) {
    img.setAttribute('draggable', 'false');
    img.setAttribute('decoding', 'async');
    img.style.pointerEvents = 'none';
  }

  // Fantôme borné : même quand l'objet occupe toute la ligne,
  // la miniature reste manipulable.
  ghost.style.width = Math.min(rect.width, 280) + 'px';
  ghost.style.height = rect.height + 'px';

  document.body.appendChild(ghost);

  drag.offsetX = drag.startX - rect.left;
  drag.offsetY = drag.startY - rect.top;
  drag.ghost = ghost;
  drag.dragging = true;

  drag.itemEl.classList.add('item-dragging');

  moveGhost(e);
}

function moveGhost(position) {
  if (!drag || !drag.ghost || !position) return;

  // Accepte soit un événement (clientX/clientY),
  // soit l'objet lastMove (x/y).
  const x = position.clientX !== undefined ? position.clientX : position.x;
  const y = position.clientY !== undefined ? position.clientY : position.y;

  drag.ghost.style.transform =
    `translate(${x - drag.offsetX}px, ${y - drag.offsetY}px) rotate(-2deg)`;
}
  

function dropTargetAt(x, y) {
  for (const el of document.elementsFromPoint(x, y)) {
    // Ignore la miniature de glisser-déposer.
    if (drag && drag.ghost && (el === drag.ghost || drag.ghost.contains(el))) {
      continue;
    }

    const t = el.closest('.slot, .pool');

    if (t && root.contains(t)) {
      return t;
    }
  }

  return null;
}

  function highlight(x, y) {
    const t = dropTargetAt(x, y);
    if (t === hoverEl) return;               // DOM touché uniquement si la cible change
    if (hoverEl) hoverEl.classList.remove('drop-hover');
    hoverEl = t;
    if (t) t.classList.add('drop-hover');
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const current = drag;
    const target = current.dragging ? dropTargetAt(e.clientX, e.clientY) : null;
    cleanupDrag();                           // avant tout rendu : le DOM va être reconstruit
    if (!current.dragging) openItem(current.key);
    else if (target) performDrop(current.key, target);
  }

  function onPointerCancel(e) {
    if (drag && (!e || e.pointerId === drag.pointerId)) cleanupDrag();
  }

function cleanupDrag() {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerCancel);

  if (moveFrame) cancelAnimationFrame(moveFrame);
  moveFrame = 0;

  if (hoverEl) {
    hoverEl.classList.remove('drop-hover');
    hoverEl = null;
  }

  if (drag) {
    drag.itemEl.classList.remove('item-dragging');

    if (drag.ghost) drag.ghost.remove();
  }

  drag = null;
}

  function performDrop(key, target) {
    const item = board.items[key];
    const moduleId = target.dataset.slotModule || target.dataset.poolModule;
    if (!item || !target.isConnected || item.moduleId !== moduleId) return;

    const previousRow = board.placement[key];

    if (target.classList.contains('pool')) {
      if (previousRow === null) return;
      
      setPlacement(key, null);
      refreshDropDisplay(moduleId, null, previousRow);
      return;
    }

    const rowIndex = Number(target.dataset.row);
    if (!App.state.rows()[rowIndex]) return;
    
    const occupant = occupantOf(moduleId, rowIndex);
    if (occupant === key) return;

    setPlacement(key, rowIndex);
    
    if (occupant) { 
    setPlacement(occupant, previousRow);  
    } 
    refreshDropDisplay(moduleId, rowIndex, previousRow);
  }

  /** Met à jour uniquement la réserve du module et les cases concernées. */
function refreshDropDisplay(moduleId, rowIndex, previousRow) {
  const m = assocMods().find((x) => x.id === moduleId); 
  const pool = root.querySelector(`#pool-${cssId(moduleId)}`);

  if (!pool || !m) return;

  // Reconstruit la réserve du module concerné.
  pool.innerHTML = poolHtml(moduleId);

  // Met à jour la case où l'étiquette a été déposée,
  // ainsi que la case d'où elle vient, si nécessaire.
  [rowIndex, previousRow].forEach((row) => {
    if (row === null || row === undefined) return;

    const slot = root.querySelector(
      `.slot[data-slot-module="${cssId(moduleId)}"][data-row="${row}"]`
    );

    if (!slot) return;

    const key = occupantOf(moduleId, row);

    slot.innerHTML = key ? itemHtml(key) : slotHint(m);
  });

  updateSaveButton();
}

  /* =========================================================
     OUVERTURE DES ÉLÉMENTS (simple clic)
     ========================================================= */
  function openItem(key) {
    const item = board.items[key];
    const type = App.schema.Types[item.kind];
    const set = viewed[item.moduleId];
    const isNew = !!set && !set.has(key);
    if (set) set.add(key);

    const el = root.querySelector('[data-item-key="' + cssId(key) + '"]');
    const run = () => {
      if (type && type.open) type.open(item.value);
      // Le rendu n'est refait que si cette ouverture peut changer un verrou
      if (isNew && assocMods().some((m) => m.unlockAfter && m.unlockAfter.includes(item.moduleId))) {
        render();
      }
    };

    if (el) {
      el.classList.add('item-clicked');
      setTimeout(() => { el.classList.remove('item-clicked'); run(); }, 110);
    } else {
      run();
    }
  }

  /* =========================================================
     CALCUL DES RÉSULTATS
     ========================================================= */
  function computeAnswers() {
    const c = cfg();
    const mods = assocMods();
    const mode = (c.scoring && c.scoring.mode) || 'all-or-nothing';
    const weights = (c.scoring && c.scoring.weights) || {};
    const weightOf = (m) => Number(weights[m.id]) || 1;

    let total = 0;
    let max = 0;
    const answers = App.state.rows().map((r, index) => {
      const cells = {};
      const pairs = {};
      mods.forEach((m) => {
        const key = occupantOf(m.id, index);
        const item = key ? board.items[key] : null;
        cells[m.id] = item ? String(item.rowId) : null;
        pairs[m.id] = !!item && item.rowId === r.id;
      });
      const correct = mods.every((m) => pairs[m.id]);

      if (mode === 'pairs') {
        max += mods.length;
        total += mods.filter((m) => pairs[m.id]).length;
      } else if (mode === 'weighted') {
        max += mods.reduce((s, m) => s + weightOf(m), 0);
        total += mods.reduce((s, m) => s + (pairs[m.id] ? weightOf(m) : 0), 0);
      } else {                                   // 'all-or-nothing'
        max += 1;
        total += correct ? 1 : 0;
      }
      return { row: r, cells, pairs, correct };
    });
    return { answers, total, max };
  }

  function onSave() {
    if ($('#s-save').disabled) return;
    const { answers, total, max } = computeAnswers();

    const input = prompt('Ton nom (nom + prénom) :', '');
    if (input === null) return;
    const name = input.trim() || 'anonyme';

    const payload = {
      type: 'assoc3-result',
      version: 2,
      savedAt: new Date().toISOString(),
      student: { name },
      score: { total, max },
      answers
    };

    const safeName = name.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase() || 'anonyme';
    const stamp = payload.savedAt.replace(/[:.]/g, '-').slice(0, 19);
    const filename = 'resultat_' + safeName + '_' + stamp + '.json';

    App.utils.download(filename, JSON.stringify(payload, null, 2), 'application/json');
    alert('Le téléchargement des réponses a été lancé.\n\nFichier : ' + filename);
  }
})();
