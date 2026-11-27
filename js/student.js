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
  // Bacs dont la taille des vignettes est déjà figée (voir freezePoolColumns)
  const frozenPools = {};
  /* Lignes complètes au rendu précédent : pour ne fêter que les lignes qui
     VIENNENT d'être complétées (pas un simple re-rendu, ni le chargement). */
  let completedPrev = null;
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
        <div class="instructions" id="s-instructions"></div>
        <div class="tools">
          <button type="button" class="btn" id="s-save" disabled>Enregistrer mes réponses</button>
          <button type="button" class="btn" id="s-reset">Recommencer</button>
        </div>
      </div>
      <div class="student-body">
        <aside class="info-sidebar" id="s-info-left" hidden></aside>
        <div class="student-center">
          <div id="s-pools-zone"></div>
          <div class="student-main-row">
            <div class="board" id="board"></div>
          </div>
        </div>
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
    /* La vue élève peut être re-rendue pendant qu'elle est cachée (le prof
       modifie la maquette) : on retente le figage des vignettes dès que la
       vue redevient visible (bascule student-mode sur <body>). */
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => tryFreezePending())
        .observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
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
    root.addEventListener('click', (e) => {
      const el = e.target.closest('.info-item-clickable');
      if (el) openInfoModal(el.dataset.infoModule);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target.closest ? e.target.closest('.info-item-clickable') : null;
      if (el) { e.preventDefault(); openInfoModal(el.dataset.infoModule); }
    });

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
    completedPrev = null;   // pas de feux d'artifice au chargement initial

    const subEl = $('#s-instructions');
    const sub = c.subtitle || '';
    if (/<[a-z!/]/i.test(sub)) {
      subEl.innerHTML = App.utils.resolveMediaInHtml
        ? App.utils.resolveMediaInHtml(sub) : sub;
    } else {
      subEl.textContent = sub;
    }
    $('.student').classList.toggle('pools-bottom', !!(c.layout && c.layout.poolsSide === 'bottom'));

    /* Panneaux d'information : à côté du plateau (position d'origine), à
       côté des réserves, ou pleine hauteur (encadrent les réserves ET le
       plateau, sur toute la hauteur de l'exercice). On détache d'abord les
       asides AVANT de réécrire le contenu de la zone des réserves. */
    const zone = $('#s-pools-zone');
    const mainRow = root.querySelector('.student-main-row');
    const bodyRow = root.querySelector('.student-body');
    const center = root.querySelector('.student-center');
    const asideL = $('#s-info-left');
    const asideR = $('#s-info-right');
    const asideMode = (c.layout && c.layout.infosAside && ['board','pools','both'].indexOf(c.layout.infosAside) !== -1)
      ? String(c.layout.infosAside)
      : ((c.layout && c.layout.infosBesidePools) ? 'pools' : 'board');
    const move = (aside, parent, before) => {
      if (aside && aside.parentElement !== parent) parent.insertBefore(aside, before || null);
    };
    move(asideL, bodyRow, center);
    move(asideR, bodyRow, null);
    zone.classList.remove('pools-with-infos');
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
            <span>${esc(modLabel(m))}</span>
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
          <button type="button" class="module-nav" data-nav-dir="prev"
            aria-label="Module précédent" title="Module précédent"
            style="display:none;position:absolute;top:50%;transform:translateY(-50%);left:.15rem;width:40px;height:56px;font-size:2.4rem;line-height:1;border:none;background:transparent;color:#475569;opacity:.35;cursor:pointer;z-index:6">‹</button>
          <button type="button" class="module-nav" data-nav-dir="next"
            aria-label="Module suivant" title="Module suivant"
            style="display:none;position:absolute;top:50%;transform:translateY(-50%);right:.15rem;width:40px;height:56px;font-size:2.4rem;line-height:1;border:none;background:transparent;color:#475569;opacity:.35;cursor:pointer;z-index:6">›</button>
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
    if (asideMode === 'pools') {
      zone.classList.add('pools-with-infos');
      zone.insertBefore(asideL, zone.firstChild);
      zone.appendChild(asideR);
    } else if (asideMode === 'board') {
      move(asideL, mainRow, document.getElementById('board'));
      move(asideR, mainRow, null);
    }
    expandedModuleId = null;

    viewed = {};
    Object.keys(frozenPools).forEach((k) => { delete frozenPools[k]; });
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
    const mod = cfg().modules.find((x) => String(x.id) === String(item.moduleId));
    return App.schema.Types[item.kind].render(item.value,
      { key, module: item.moduleId, titleOnly: !!(mod && mod.poolTitleOnly),
        poolTitleStyle: !!(mod && mod.poolTitleStyle) });
  };

  /* Signature d'une valeur : pour dédupliquer la réserve. Quand le prof a
     copié un contenu sur plusieurs lignes, un seul exemplaire s'affiche ;
     il ne disparaît qu'une fois la dernière copie déposée. */
  const sigOf = (v) => JSON.stringify(v == null ? null : v);

  /* Taille des vignettes figée au départ (bacs en mode « Auto »).
     Au premier affichage du bac complet, on relève combien d'éléments
     tiennent par ligne dans la disposition voulue par le prof, puis on
     bascule le bac en grille « N par ligne » : les vignettes gardent
     ensuite exactement la même taille du début à la fin de l'exercice,
     même quand il ne reste que très peu d'éléments dans le bac.
     IMPORTANT : la mesure n'a de sens que si le bac est réellement
     affiché (vue élève visible) — dans une vue cachée tous les offsets
     valent 0 et tout semblerait tenir sur une seule ligne. */
  function freezePoolColumns(pool) {
    if (pool.closest('[hidden]')) return;   // vue pas encore affichée : on réessaiera
    const items = Array.prototype.slice.call(pool.querySelectorAll(':scope > .item'));
    if (!items.length) return;
    let perRow = 1;
    const firstTop = items[0].offsetTop;
    for (let i = 1; i < items.length; i++) {
      if (Math.abs(items[i].offsetTop - firstTop) <= 1) perRow++;
      else break;
    }
    frozenPools[pool.id] = true;
    pool.classList.add('is-gridded');
    pool.style.setProperty('--pool-cols', perRow);
  }

  /* Conditions de figage partagées entre render() et les nouvelles tentatives */
  function freezeEligible(m, pool) {
    return !m.poolCols && !frozenPools[pool.id] && board && board.keys[m.id] &&
      board.keys[m.id].length &&
      board.keys[m.id].every((k) => board.placement[k] === null) &&
      !(moduleState[m.id] && moduleState[m.id].locked);
  }

  /* Réessaie de figer les bacs restés non mesurés : la vue élève peut être
     re-rendue pendant qu'elle est cachée (quand le prof modifie la maquette),
     auquel cas la mesure était impossible. On retente dès qu'elle redevient
     visible (bascule de mode), tant qu'aucun élément n'a été déposé. */
  function tryFreezePending() {
    assocMods().forEach((m) => {
      const pool = document.getElementById('pool-' + cssId(m.id));
      if (pool && freezeEligible(m, pool)) freezePoolColumns(pool);
    });
  }

  function poolHtml(moduleId) {
    const unplaced = board.keys[moduleId].filter((k) => board.placement[k] === null);
    const reps = new Map();
    unplaced.forEach((k) => {
      const s = sigOf(board.items[k].value);
      if (!reps.has(s)) reps.set(s, k);
    });
    return [...reps.values()].map(itemHtml).join('');
  }

  /* =========================================================
     RÉCOMPENSES VISUELLES (option prof : layout.rewards)
     Feux d'artifice quand une ligne passe de incomplète à complète ;
     grande salve quand TOUTES les lignes le sont. Couche fixe sans
     interaction (pointer-events:none), particules auto-nettoyées.
     ========================================================= */
  const FX_COLORS = ['#f59e0b','#ef4444','#22c55e','#3b82f6','#a855f7','#ec4899','#facc15','#14b8a6'];
  function fxLayer() {
    let el = document.getElementById('fx-layer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fx-layer';
      document.body.appendChild(el);
    }
    return el;
  }
  function fxShow(x, y, power) {
    const layer = fxLayer();
    const p = Math.max(0.15, Math.min(1.6, power == null ? 1 : power));
    const n = Math.round(10 + 38 * p);
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'fx-spark';
      const ang = Math.random() * Math.PI * 2;
      const dist = 40 + 55 * p + Math.random() * (30 + 60 * p);
      s.style.left = Math.round(x) + 'px';
      s.style.top = Math.round(y) + 'px';
      s.style.setProperty('--fx-x', Math.round(Math.cos(ang) * dist) + 'px');
      s.style.setProperty('--fx-y', Math.round(Math.sin(ang) * dist) + 'px');
      s.style.setProperty('--fx-c', FX_COLORS[i % FX_COLORS.length]);
      s.style.setProperty('--fx-d', (0.7 + Math.random() * 0.6).toFixed(2) + 's');
      s.style.setProperty('--fx-s', (0.6 + Math.random() * 0.9).toFixed(2));
      layer.appendChild(s);
      setTimeout(() => { if (s.parentNode) s.parentNode.removeChild(s); }, 1600);
    }
  }
  /* Mode de récompense choisi par le prof : 'off' | 'on' | 'progressive'.
     (Compatibilité : ancien layout.rewards true/false.) */
  function rewardsMode() {
    const r = cfg().layout && cfg().layout.rewards;
    if (r === 'progressive') return 'progressive';
    if (r === 'on' || r === true) return 'on';
    return 'off';
  }
  function fxEnabled() { return rewardsMode() !== 'off'; }

  /* Points gagnés par la combinaison de la ligne : fraction de paires
     correctes (chaque élément au bon endroit rapporte, selon le barème
     du prof — paires, pondéré, ou tout-ou-rien). 0 = combinaison fausse. */
  function rowScoreRatio(rowIndex) {
    const mods = assocMods();
    if (!mods.length) return 0;
    const r = App.state.rows()[rowIndex];
    if (!r) return 0;
    let ok = 0;
    mods.forEach((m) => {
      const key = occupantOf(m.id, rowIndex);
      if (key && board.items[key] && String(board.items[key].rowId) === String(r.id)) ok++;
    });
    return ok / mods.length;
  }

  function celebrateRow(rowEl, rowIndex) {
    const mode = rewardsMode();
    if (mode === 'off') return;
    let power = 0.85;                                  // « on » : intensité constante
    if (mode === 'progressive') {
      const ratio = rowScoreRatio(rowIndex);
      if (ratio <= 0) return;                          // combinaison fausse : pas de feu d'artifice
      power = 0.25 + 0.75 * ratio;                     // réussite partielle → salve modérée
    }
    const r = rowEl && rowEl.getBoundingClientRect ? rowEl.getBoundingClientRect() : null;
    const x = (r && r.width) ? r.left + r.width / 2 : window.innerWidth / 2;
    const y = (r && r.height) ? r.top + r.height / 2 : window.innerHeight / 3;
    fxShow(x, y, power);
  }

  function render() {
    const rows = App.state.rows();
    const mods = assocMods();
    const hasData = rows.length > 0;

    $('#s-empty').hidden = hasData;
    $('#s-pools-zone').style.display = hasData ? '' : 'none';
    updateSaveButton();
    if (!hasData) { $('#board').innerHTML = ''; completedPrev = null; return; }

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
        /* Figé la taille des vignettes au premier affichage du bac complet :
           le nombre d'éléments par ligne relevé à ce moment ne change plus,
           même quand le bac se vide. (Inutile si le prof a déjà imposé un
           « N par ligne » : la grille est alors figée par construction.) */
        if (freezeEligible(m, pool)) freezePoolColumns(pool);
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

    checkCompletions();
  }

  /* Récompenses visuelles : on fête les lignes qui VIENNENT d'être
     complétées (transition depuis l'affichage précédent) — pas les lignes
     déjà complètes au chargement, ni un simple re-rendu. Appelé après
     chaque changement de placement (dépôt complet comme partiel). */
  function checkCompletions() {
    if (!board) return;
    const rows = App.state.rows();
    const mods = assocMods();
    const completedNow = [];
    for (let r = 0; r < rows.length; r++) {
      if (mods.every((m) => occupantOf(m.id, r))) completedNow.push(r);
    }
    if (completedPrev !== null) {
      const fresh = completedNow.filter((r) => completedPrev.indexOf(r) === -1);
      if (fresh.length) {
        const rowEl = $('#board').querySelector('.row[data-row="' + fresh[0] + '"]');
        celebrateRow(rowEl, fresh[0]);
      }
      if (rows.length && completedNow.length === rows.length &&
          completedPrev.length < rows.length) {
        setTimeout(() => {
          const mode = rewardsMode();
          if (mode === 'off') return;
          let power = 1.5;                             // toutes les lignes : grande salve
          if (mode === 'progressive') {
            const mods = assocMods();
            let ok = 0;
            rows.forEach((r, ri) => mods.forEach((m) => {
              const key = occupantOf(m.id, ri);
              if (key && board.items[key] && String(board.items[key].rowId) === String(r.id)) ok++;
            }));
            const ratio = mods.length ? ok / (rows.length * mods.length) : 0;
            if (ratio <= 0) return;                    // tout faux : pas de célébration
            power = 0.6 + 0.9 * ratio;
          }
          fxShow(window.innerWidth / 2, window.innerHeight / 2, power);
        }, 550);
      }
    }
    completedPrev = completedNow;
  }

  /* Agencement exact d'une ligne de référence réalisé sur la ligne du
     plateau d'index i : chaque module à associer a un élément déposé,
     et tous ces éléments appartiennent à cette même ligne de référence.
     La position n'importe pas : l'élève peut réaliser cet agencement sur
     n'importe quelle ligne du plateau. */
  function rowArrangementPresent(rowIndex, rowId) {
    return assocMods().every((m) => {
      const key = occupantOf(m.id, rowIndex);
      return !!key && String(board.items[key].rowId) === String(rowId);
    });
  }

  /* Contenu du panneau : valide s'il est défini (un seul contenu par module). */
  function infoDataOf(m) {
    const type = App.schema.Types[m.kind];
    return (type && m.data != null && type.validate(m.data)) ? m.data : null;
  }

  /* Titre affiché quand le prof choisit « seulement le titre ». */
  function infoTitleOf(m) {
    const v = infoDataOf(m);
    const t = v == null ? '' : (typeof v === 'string' ? v : String(v.title || v.caption || ''));
    return (App.utils.stripHtml(t) || modLabel(m)).slice(0, 80);
  }

  /* Condition « consultation » : tous les éléments des modules cochés
     (verrouillage pédagogique) ont été ouverts par l'élève. */
  function infoDepsViewed(m) {
    if (!m.unlockAfter || !m.unlockAfter.length) return true;
    return m.unlockAfter.every((depId) => {
      const keys = (board && board.keys[depId]) || [];
      const set = viewed[depId];
      return keys.length === 0 || (!!set && keys.every((k) => set.has(k)));
    });
  }

  /* Condition d'apparition d'un module informatif : l'agencement exact des
     éléments de l'UNE des lignes pointées par le prof est réalisé par
     l'élève — sur n'importe quelle ligne du plateau — et/ou éléments
     consultés. Sans condition : toujours. */
  function infoVisible(m) {
    if (!infoDepsViewed(m)) return false;
    const reveal = Array.isArray(m.revealRows) ? m.revealRows : [];
    if (!reveal.length) return true;
    const rows = App.state.rows();
    return reveal.some((rid) =>
      rows.some((_, i) => rowArrangementPresent(i, rid)));
  }

  function renderInfoSidebars() {
    const infos = infoMods().filter((m) => infoVisible(m) && infoDataOf(m));

    [['left', $('#s-info-left')], ['right', $('#s-info-right')]].forEach(([side, el]) => {
      const html = infos.filter((m) => m.zone === side).map((m) => {
        const type = App.schema.Types[m.kind];
        const head = '<div class="info-module"><h4>' + esc(modLabel(m)) + '</h4>';
        if (m.infoMode === 'title') {
          const dv = infoDataOf(m);
          /* Étiquette = bandeau coloré, texte lisible (contraste automatique). */
          const tc = (dv && dv.titleColor && /^#[0-9a-fA-F]{3,8}$/.test(dv.titleColor))
            ? ' style="background:' + esc(dv.titleColor) + ';color:' + esc(App.utils.contrastText(dv.titleColor)) + ';border-color:' + esc(dv.titleColor) + '"' : '';
          return head +
            '<button type="button" class="info-title-link info-item-clickable" data-info-module="' + esc(m.id) + '"' + tc +
            ' title="Afficher en grand">' + esc(infoTitleOf(m)) + '</button></div>';
        }
        const rendered = type.render(m.data, { key: 'info_' + m.id, static: true });
        if (!m.clickable) return head + rendered + '</div>';
        return '<div class="info-item-clickable" data-info-module="' + esc(m.id) +
          '" role="button" tabindex="0" title="Afficher en grand">' + rendered + '</div>';
      }).join('');
      el.innerHTML = html;
      el.hidden = !html;
    });
  }

  function updateSaveButton() {
    $('#s-save').disabled = !(board && board.total > 0 && board.placed === board.total);
  }

  /* Module d'information cliquable : fenêtre adaptée au contenu
     (texte agrandi, image agrandie, média lisible… ). */
  function openInfoModal(moduleId) {
    const m = infoMods().find((x) => String(x.id) === String(moduleId));
    if (!m) return;
    const v = infoDataOf(m);
    const type = App.schema.Types[m.kind];
    if (!type || !v) return;

    if (m.kind === 'image') {
      App.modal.openImage(App.media.resolve(v.src), v.caption || modLabel(m));
      return;
    }

    let body = '';
    if (m.kind === 'richtext') {
      body = '<div class="modal-rich">' + App.utils.resolveMediaInHtml(v.html || '') + '</div>';
    } else if (m.kind === 'text') {
      body = '<p class="modal-info-text">' + esc(v) + '</p>';
    } else if (m.kind === 'audio' || m.kind === 'video' || m.kind === 'url') {
      body = (m.kind === 'audio'
        ? '<audio controls src="' + esc(App.media.resolve(v.src)) + '" style="width:100%"></audio>'
        : m.kind === 'video'
          ? '<video controls src="' + esc(App.media.resolve(v.src)) + '" style="width:100%;max-height:60vh"></video>'
          : '<iframe class="modal-web-frame" src="' + esc(v.src) + '" sandbox="allow-scripts allow-same-origin"></iframe>') +
        (v.html ? '<div class="modal-rich" style="margin-top:.75rem">' + App.utils.resolveMediaInHtml(v.html) + '</div>' : '');
    } else if (typeof type.open === 'function') {
      type.open(v);
      return;
    }
    const infoTitle = (m.kind === 'richtext' && v && v.title &&
      App.utils.stripHtml(String(v.title))) || modLabel(m);
    App.modal.open({ title: infoTitle, html: body || '<p>—</p>', wide: m.kind === 'url',
      titleColor: (m.kind === 'richtext' && v && v.titleColor) || '' });
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
    // L'affichage des flèches est piloté ici (et non par la feuille de
    // style) : elles apparaissent ainsi même avec un CSS non à jour.
    col.querySelectorAll('.module-nav').forEach((n) => {
      n.style.display = expand ? 'flex' : 'none';
    });
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

  // Le fantôme ne doit jamais dépasser la largeur du panneau qui
  // accueillera l'élément (case du plateau) : même quand une réserve
  // n'a plus qu'un ou deux objets immenses, il reste manipulable
  // et le pointeur reste bien dessus.
  const slot = root.querySelector('.slot[data-slot-module="' + cssId(board.items[drag.key].moduleId) + '"]');
  const slotW = slot ? slot.getBoundingClientRect().width : 0;
  const ghostW = Math.min(rect.width, 280, slotW > 40 ? slotW : Infinity);

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
  ghost.style.width = ghostW + 'px';
  ghost.style.height = rect.height + 'px';

  document.body.appendChild(ghost);

  // Le point du fantôme qui suit la souris est borné au fantôme :
  // sur un bouton géant, le pointeur ne « décolle » plus de la vignette.
  drag.offsetX = Math.min(Math.max(drag.startX - rect.left, 0), Math.max(0, ghostW - 12));
  drag.offsetY = Math.min(Math.max(drag.startY - rect.top, 0), Math.max(0, rect.height - 12));
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
  checkCompletions();   // le placement vient d'être mis à jour : fêter si besoin
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
  renderInfoSidebars();
}

  /* =========================================================
     OUVERTURE DES ÉLÉMENTS (simple clic)
     ========================================================= */
  /* Fait comme « vu » tous les jumeaux (contenus identiques) d'un élément :
     utile quand le prof a copié le même contenu sur plusieurs lignes —
     sinon les verrous « à ouvrir avant » ne pourraient jamais sauter. */
  function markViewedTwin(moduleId, key) {
    const set = viewed[moduleId];
    if (!set) return;
    const s = sigOf(board.items[key] ? board.items[key].value : null);
    (board.keys[moduleId] || []).forEach((k) => {
      if (board.items[k] && sigOf(board.items[k].value) === s) set.add(k);
    });
  }

  function openItem(key) {
    const item = board.items[key];
    const type = App.schema.Types[item.kind];
    const set = viewed[item.moduleId];
    const isNew = !!set && !set.has(key);
    if (set) markViewedTwin(item.moduleId, key);

    const el = root.querySelector('[data-item-key="' + cssId(key) + '"]');
    const run = () => {
      if (type && type.open) type.open(item.value);
      injectModalNav(item.moduleId, key);
      // Le rendu n'est refait que si cette ouverture peut changer un verrou
      if (isNew && assocMods().some((m) => m.unlockAfter && m.unlockAfter.includes(item.moduleId))) {
        render();
      } else if (isNew) {
        // Un panneau d'information peut dépendre de la consultation des éléments
        const depInfo = cfg().modules.some((m) => m.role === 'informative' &&
          Array.isArray(m.unlockAfter) && m.unlockAfter.includes(item.moduleId));
        if (depInfo) renderInfoSidebars();
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
     NAVIGATION ‹ › ENTRE LES ÉLÉMENTS D'UN MÊME BAC
     Injectée dans la fenêtre de visualisation (image, son, vidéo,
     page web, cartel…) ouverte au clic sur un élément du pool.
     ========================================================= */
  function injectModalNav(moduleId, currentKey) {
    const keys = board.keys[moduleId] || [];
    if (keys.length < 2) return;
    const box = document.querySelector('#modal-root .modal-image, #modal-root .modal');
    if (!box) return;
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    const i = keys.indexOf(currentKey);
    const state = { keys, i };
    const style = 'position:absolute;top:50%;transform:translateY(-50%);width:40px;height:64px;' +
      'font-size:2.6rem;line-height:1;border:none;background:transparent;color:#64748b;' +
      'opacity:.4;cursor:pointer;z-index:20;';
    const mkBtn = (dir) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'modal-nav';
      b.dataset.itemNav = dir;
      b.textContent = dir === 'prev' ? '‹' : '›';
      b.setAttribute('aria-label', dir === 'prev' ? 'Élément précédent' : 'Élément suivant');
      b.title = b.getAttribute('aria-label');
      b.style.cssText = style + (dir === 'prev' ? 'left:.35rem' : 'right:.35rem');
      return b;
    };
    box.appendChild(mkBtn('prev'));
    box.appendChild(mkBtn('next'));
    box.querySelectorAll('.modal-nav').forEach((b) => {
      b.addEventListener('click', () => {
        const n = state.keys.length;
        state.i = ((state.i + (b.dataset.itemNav === 'prev' ? -1 : 1)) % n + n) % n;
        const k = state.keys[state.i];
        const item = board.items[k];
        const set = viewed[moduleId];
        const isNew = !!set && !set.has(k);
        if (set) markViewedTwin(moduleId, k);
        App.schema.Types[item.kind].open(item.value);
        setTimeout(() => injectModalNav(moduleId, k), 0);
        if (isNew && assocMods().some((m) => m.unlockAfter && m.unlockAfter.includes(moduleId))) {
          render();
        }
      });
    });
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
