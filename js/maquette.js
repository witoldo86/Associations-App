/* js/maquette.js — éditeur visuel de la mise en page (espace prof)
   Les modifications se font sur un BROUILLON, puis sont enregistrées
   AUTOMATIQUEMENT une fraction de seconde après le dernier geste :
   les espaces élève/prof suivent tout de suite, sans bouton « Valider ». */
(function () {
  const App = (window.App = window.App || {});
  const M = (App.maquette = {});
  const T = App.theme;
  const esc = App.utils.escapeHtml;

  // Zones acceptées par type d'élément glissé (pools-order = réordonner dans les Réserves)
  const ACCEPTS = {
    module: ['columns', 'left', 'right', 'hidden', 'pools-order'],
    pools: ['pools-top', 'pools-bottom'],
    row: ['rows']
  };
  // Zones recevant un bouton « + » d'ajout de module
  const ADD_ZONE = { columns: 'columns', 'pools-top': 'pools', 'pools-bottom': 'pools', left: 'left', right: 'right', hidden: 'hidden' };

  const chipActions = (id, withColor, withContents) =>
    '<span class="mq-acts">' +
      '<button type="button" class="mq-act" data-mq-act="edit" data-act-id="' + esc(id) + '" title="Éditer ce module">✎</button>' +
      (withContents
        ? '<button type="button" class="mq-act" data-mq-act="contents" data-act-id="' + esc(id) + '" title="Éditer le contenu du panneau d\'information">📝</button>'
        : '') +
      '<button type="button" class="mq-act" data-mq-act="view" data-act-id="' + esc(id) + '" title="Visualiser les contenus">📄</button>' +
      (withColor
        ? '<button type="button" class="mq-act" data-mq-act="color" data-act-id="' + esc(id) + '" title="Couleur du bac (réserves)">🎨</button>'
        : '') +
      '<button type="button" class="mq-act danger" data-mq-act="del" data-act-id="' + esc(id) + '" title="Supprimer ce module">🗑</button>' +
    '</span>';
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
  // Découpe une liste en rangées de n éléments (mode grille « N par ligne »)
  const chunkOf = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

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
      infosAside: (c.layout && c.layout.infosAside && ['board','pools','both'].indexOf(c.layout.infosAside) !== -1)
        ? String(c.layout.infosAside)
        : ((c.layout && c.layout.infosBesidePools) ? 'pools' : 'board'),
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

  /* Les polices ne se choisissent plus ici : le titre et la consigne dans
     leurs fenêtres d'édition (bouton ✎ de l'aperçu), les contenus dans chaque
     éditeur de texte enrichi. Le texte simple utilise la police système. */
  function styleBarHtml() {
    return `
      <div class="mq-stylebar">
        <span class="mq-stylebar-title">Style général</span>
        <div class="inline inline-colors">
          <div class="field field-auto"><label for="mq-primary">Principale</label>
            <input id="mq-primary" type="color" data-mq="theme.primary"></div>
          <div class="field field-auto"><label for="mq-bg">Fond</label>
            <input id="mq-bg" type="color" data-mq="theme.bg"></div>
          <div class="field field-auto"><label for="mq-ink">Texte</label>
            <input id="mq-ink" type="color" data-mq="theme.ink"></div>
        </div>
        <div class="field"><label for="mq-scale">Taille du texte</label>
          <select id="mq-scale" data-mq="theme.scale">${options(T.SCALES)}</select></div>
        <div class="field"><label for="mq-radius">Coins</label>
          <select id="mq-radius" data-mq="theme.radius">${options(T.RADII)}</select></div>
      </div>`;
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
        Tout se pilote ici : glissez les modules pour les déplacer ou les réordonner,
        ajoutez-en avec le bouton <strong>＋</strong> de chaque zone, éditez/visualisez/supprimez
        avec <strong>✎ 📄 🗑</strong> au survol des blocs, modifiez le titre, la consigne
        et la grille avec les boutons <strong>✎</strong> et <strong>⌗</strong> de l'aperçu, et mélangez
        les lignes avec <strong>🔀</strong> (espace « Ordre des lignes »). Les couleurs,
        la taille du texte et les coins se règlent dans le cadre « Style général » ;
        chaque police se choisit dans sa fenêtre d'édition (titre, consigne, contenus).
        Chaque réglage est
        <strong>enregistré automatiquement</strong> (indicateur en haut à droite) et aussitôt
        visible dans les espaces élève et prof.
      </p>
      ${styleBarHtml()}
      <div class="mq-preview-col" id="mq-preview"></div>`;

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
    /* Gestion des modules pilotée depuis les blocs et étiquettes de la maquette */
    const act = e.target.closest('[data-mq-act]');
    if (act) {
      e.preventDefault();
      e.stopPropagation();
      const id = act.dataset.actId;
      const A = App.teacher;
      if (!id || !A) return;
      if (act.dataset.mqAct === 'edit') A.editModule(id);
      else if (act.dataset.mqAct === 'contents') A.editInfoContents(id);
      else if (act.dataset.mqAct === 'view') A.moduleContents(id);
      else if (act.dataset.mqAct === 'color') openPoolColorDialog(id);
      else if (act.dataset.mqAct === 'del') A.removeModule(id);
      return;
    }
    const tog = e.target.closest('[data-drawer-toggle]');
    if (tog) {
      e.preventDefault();
      e.stopPropagation();
      const z = tog.dataset.drawerToggle;
      if (z) { drawerOpen[z] = !drawerOpen[z]; renderPreview(); }
      return;
    }
    const sh = e.target.closest('[data-mq-shuffle]');
    if (sh) {
      e.preventDefault();
      e.stopPropagation();
      draft.rowIds = App.utils.shuffle(draft.rowIds);
      renderPreview();
      scheduleApply();
      return;
    }
    const dlg = e.target.closest('[data-mq-dialog]');
    if (dlg) {
      e.preventDefault();
      e.stopPropagation();
      const k = dlg.dataset.mqDialog;
      if (!App.teacher) return;
      if (k === 'grid') App.teacher.openGridDialog();
      else App.teacher.openTextDialog(k);
      return;
    }
    const addBtn = e.target.closest('[data-mq-add]');
    if (addBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (App.teacher) App.teacher.addModule(addBtn.dataset.mqAdd);
      return;
    }
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
      poolsSide: draft.poolsSide, boardCols: draft.boardCols, poolsCols: draft.poolsCols,
      infosAside: draft.infosAside === 'both' ? 'both' : (draft.infosAside === 'pools' ? 'pools' : 'board'),
      infosBesidePools: draft.infosAside === 'pools'
    });
    c.modules = clone(draft.modules);
    // updateConfig déclenche onChange (le brouillon est reconstruit) :
    // on garde donc l'ordre des lignes du brouillon AVANT l'appel.
    const rowIds = draft.rowIds.slice();
    App.state.updateConfig(c);
    App.state.reorderRows(rowIds);
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

  // Petits boutons d'édition placés dans l'aperçu (✎ textes, ⌗ grille, 🔀 lignes)
  const editBtn = (kind, label) =>
    '<button type="button" class="mq-edit" data-mq-dialog="' + kind + '" title="' + label + '">✎</button>';
  const SHUFFLE_BTN = '<button type="button" class="mq-edit" data-mq-shuffle ' +
    'title="Mélanger les lignes (ordre aléatoire)">🔀</button>';
  const GRID_BTN = '<button type="button" class="mq-edit" data-mq-dialog="grid" ' +
    'title="Grille : modules par ligne (plateau et réserves)">⌗</button>';

  function moduleChip(m, showWidth) {
    const span = Number(m.span) || 1;
    const style = showWidth
      ? ' style="flex-grow:' + span + ';flex-basis:0;min-width:0"' : '';
    const badge = showWidth ? '' : '<span class="badge">' + esc(kindLabel(m)) + '</span>';
    const lock = (m.unlockAfter && m.unlockAfter.length)
      ? ' <span class="badge" title="Verrou pédagogique actif">🔒</span>' : '';
    return '<div class="mq-chip mq-chip-module' + (m.role === 'associate' ? ' is-assoc' : '') +
      '" data-drag-kind="module" data-drag-id="' + esc(m.id) + '" title="' + esc(m.id) + '"' + style + '>' +
      '<span class="mq-grip" aria-hidden="true">⣿</span>' +
      '<span class="mq-name">' + esc(modLabel(m)) + '</span>' +
      badge + lock +
      chipActions(m.id, false, m.role !== 'associate') + '</div>';
  }

  function zoneHtml(name, title, inner, cls, itemsAttr, labelExtra) {
    const plus = ADD_ZONE[name]
      ? '<button type="button" class="mq-add" data-mq-add="' + ADD_ZONE[name] + '" title="Ajouter un module">＋</button>' : '';
    return '<div class="mq-zone ' + (cls || '') + '" data-zone="' + name + '">' +
      '<div class="mq-zone-label">' + title + plus + (labelExtra || '') + '</div>' +
      '<div class="mq-zone-items"' + (itemsAttr || '') + '>' + (inner || '<span class="mq-empty">Déposez ici</span>') + '</div>' +
      '</div>';
  }

  /* Tiroirs repliables des panneaux gauche/droit : même structure de zone
     (mq-zone mq-side + data-zone) pour le dépôt, mais le corps se replie.
     État de session uniquement : fermés au chargement de la page. */
  const drawerOpen = { left: false, right: false };

  function sideDrawerHtml(name, title) {
    const mods = draft.modules.filter((m) => m.role === 'informative' && m.zone === name);
    const open = !!drawerOpen[name];
    const plus = ADD_ZONE[name]
      ? '<button type="button" class="mq-add" data-mq-add="' + ADD_ZONE[name] + '" title="Ajouter un module">＋</button>' : '';
    return '<div class="mq-zone mq-side mq-drawer ' + (open ? 'is-open' : 'is-closed') + '" data-zone="' + name + '">' +
      '<div class="mq-drawer-head-row">' +
        '<button type="button" class="mq-drawer-head" data-drawer-toggle="' + name + '" aria-expanded="' + open + '">' +
          '<span class="mq-drawer-chevron" aria-hidden="true">' + (open ? '\u25bd' : '\u25b7') + '</span>' +
          '<span class="mq-drawer-title">' + esc(title) + '</span>' +
          '<span class="mq-drawer-count" title="Modules dans ce panneau">' + mods.length + '</span>' +
        '</button>' + plus +
      '</div>' +
      '<div class="mq-drawer-body"' + (open ? '' : ' hidden') + '>' +
        (mods.length ? mods.map(moduleChip).join('') : '<span class="mq-empty">Déposez ici</span>') +
      '</div>' +
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

  /* Couleur pastel d'un bac de réserves (choix dans un échantillon) */
  const PASTELS = [
    ['', 'Aucune (couleur par défaut)'],
    ['#fde68a', 'Jaune pastel'],
    ['#fbcfe8', 'Rose pastel'],
    ['#bfdbfe', 'Bleu pastel'],
    ['#bbf7d0', 'Vert pastel'],
    ['#ddd6fe', 'Violet pastel'],
    ['#fed7aa', 'Orange pastel'],
    ['#99f6e4', 'Turquoise pastel'],
    ['#e5e7eb', 'Gris clair']
  ];

  function openPoolColorDialog(id) {
    const m = draft.modules.find((x) => x.id === id);
    if (!m) return;
    const cur = m.poolColor || '';
    const sw = PASTELS.map(([v, l]) =>
      '<button type="button" class="swatch' + (v === cur ? ' is-selected' : '') +
      '" data-swatch="' + esc(v) + '" style="background:' + (v || '#fff') +
      '" title="' + esc(l) + '" aria-label="' + esc(l) + '"></button>').join('');
    App.modal.open({
      title: 'Couleur du bac « ' + modLabel(m) + ' » (affiché dans les réserves)',
      html: '<div class="swatch-list">' + sw + '</div>' +
        '<p class="hint">La couleur teinte le fond du bac côté élève.</p>'
    });
    [...document.querySelectorAll('[data-swatch]')].forEach((btn) => {
      btn.addEventListener('click', () => {
        m.poolColor = btn.dataset.swatch || '';
        if (!m.poolColor) delete m.poolColor;
        App.modal.close();
        renderPreview();
        scheduleApply();
      });
    });
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
    const miniChip = (m, flex) => {
      const st = [
        flex ? 'flex-grow:' + poolSpanOf(m) + ';flex-basis:0' : '',
        m.poolColor ? 'background:' + esc(m.poolColor) : ''
      ].filter(Boolean).join(';');
      return '<span class="mq-mini" data-drag-kind="module" data-drag-id="' + esc(m.id) +
        '" data-span-id="' + esc(m.id) + '"' +
        (st ? ' style="' + st + '"' : '') +
        ' title="' + esc(m.id) + '">' + esc(modLabel(m)) + chipActions(m.id, true) + '</span>';
    };
    let poolsInner;
    let poolsMiniAttr = '';
    if (poolsOneLine) {
      const n = assoc.length;
      const fair = n > 1 ? 'calc((100% - ' + (9 * (n - 1)) + 'px)/' + n + ')' : '100%';
      const poolParts = [];
      assoc.forEach((m, i) => { if (i) poolParts.push('9px'); poolParts.push('minmax(min(190px,' + fair + '),' + poolSpanOf(m) + 'fr)'); });
      poolsInner = assoc.map((m) => miniChip(m, false)).join(RESIZER);
      poolsMiniAttr = ' style="grid-template-columns:' + poolParts.join(' ') + '"';
    } else {
      poolsInner = chunkOf(assoc, pc).map((g) =>
        '<div class="mq-mrow">' + g.map((m) => miniChip(m, true)).join(RESIZER) + '</div>').join('');
    }
    const poolsChip = '<div class="mq-chip mq-chip-pools" data-drag-kind="pools" data-drag-id="pools">' +
      '<span class="mq-grip" aria-hidden="true">⠿</span>' +
      '<div class="mq-pools-body"><div class="mq-pools-title">Réserves</div>' +
      '<div class="mq-mini-pools" data-zone="pools-order"' + poolsMiniAttr + '>' + poolsInner + '</div></div></div>';

    // Plateau : rangées de N modules (poignées entre voisins de la même
    // rangée), ou une seule ligne si N vaut 0 ou que la grille tient de toute
    // façon sur une ligne — dans ce cas, largeurs manuelles et séparateurs.
    const bcDraft = gridCols(draft.boardCols, assoc.length);
    const bc = (bcDraft && bcDraft >= assoc.length) ? 0 : bcDraft;
    // Grille N par ligne : rangées de N modules, poignées entre voisins de
    // la même rangée (les largeurs span restent respectées dans chaque rangée).
    const boardInner = bc
      ? chunkOf(assoc, bc).map((g) =>
          '<div class="mq-mrow">' + g.map((m) => moduleChip(m, true)).join(RESIZER) + '</div>').join('')
      : assoc.map((m) => moduleChip(m, true)).join(RESIZER);
    const poolsZone = (name, side) => zoneHtml(name, 'Réserves',
      draft.poolsSide === side ? poolsChip : '', 'mq-pools', '', GRID_BTN);

    /* Panneaux d'information : à côté du plateau (défaut), à côté des
       réserves, ou pleine hauteur (encadrent les réserves ET le plateau) —
       choix du prof dans la fenêtre Grille. */
    const asideMode = draft.infosAside === 'both' ? 'both'
      : (draft.infosAside === 'pools' || draft.infosBesidePools) ? 'pools' : 'board';
    const leftZone = sideDrawerHtml('left', 'Panneau gauche');
    const rightZone = sideDrawerHtml('right', 'Panneau droit');
    const columnsZone = zoneHtml('columns', 'Plateau — colonnes à associer (dans l\'ordre)',
      boardInner, 'mq-board', '', GRID_BTN);
    const mainRow = '<div class="mq-main">' +
      (asideMode === 'board' ? leftZone : '') + columnsZone +
      (asideMode === 'board' ? rightZone : '') + '</div>';
    const besideRow = '<div class="mq-beside-row">' +
      leftZone +
      (draft.poolsSide === 'top' ? poolsZone('pools-top', 'top') : poolsZone('pools-bottom', 'bottom')) +
      rightZone + '</div>';

    $('#mq-preview').innerHTML =
      '<div class="mq-screen" style="' + esc(style) + '">' +
        '<div class="mq-title">' + esc(draft.title || 'Titre') +
          editBtn('title', 'Modifier le titre (texte, taille, couleur, police)') + '</div>' +
        '<div class="mq-subtitle">' + esc(App.utils.stripHtml(draft.subtitle)) +
          editBtn('subtitle', 'Modifier la consigne (texte enrichi, taille, police)') + '</div>' +
        (asideMode === 'both'
          ? '<div class="mq-canvas">' + leftZone +
              '<div class="mq-center">' +
                poolsZone('pools-top', 'top') + mainRow + poolsZone('pools-bottom', 'bottom') +
              '</div>' + rightZone + '</div>'
          : asideMode === 'pools'
            ? (draft.poolsSide === 'top'
                ? besideRow + mainRow + poolsZone('pools-bottom', 'bottom')
                : poolsZone('pools-top', 'top') + mainRow + besideRow)
            : poolsZone('pools-top', 'top') + mainRow + poolsZone('pools-bottom', 'bottom')) +
      '</div>' +
      zoneHtml('hidden', 'Modules masqués (non affichés à l\'élève)', inZone('hidden').map(moduleChip).join(''), 'mq-hidden mq-cards') +
      zoneHtml('rows', 'Ordre des lignes', rowChips(), 'mq-rows', '', SHUFFLE_BTN);
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
    const chip = e.target.closest('.mq-chip, .mq-mini');
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
    const z = el && el.closest('.mq-zone, [data-zone]');
    return z && root.contains(z) && ACCEPTS[drag.kind] && ACCEPTS[drag.kind].includes(z.dataset.zone) ? z : null;
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
    const sel = zone.dataset.zone === 'pools-order' ? '.mq-mini' : '.mq-chip';
    drop(d, zone.dataset.zone, insertIndex(zone, d, e.clientX, e.clientY, sel));
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
    const isPools = !!sep.closest('.mq-mini-pools');
    const wKey = isPools ? 'poolSpan' : 'span';
    const widths = mods.map((m) => Math.max(0.5, Number(m[wKey]) || 1));
    const lr = left.getBoundingClientRect();
    const rr = right.getBoundingClientRect();
    rz = {
      chips: [left, right], mods, wKey,
      spans: widths,
      pxPerSpan: (lr.width + rr.width) / (widths[0] + widths[1]),
      grid: (isPools && sep.parentNode.classList &&
        sep.parentNode.classList.contains('mq-mini-pools')) ? sep.parentNode : null,
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
    if (rz.chips[0]) rz.chips[0].style.flexGrow = a;
    if (rz.chips[1]) rz.chips[1].style.flexGrow = b;
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

  /** Position d'insertion parmi les éléments de la zone (hors élément glissé).
      sel : sélecteur des éléments frères ('.mq-chip' ou '.mq-mini'). */
  function insertIndex(zoneEl, d, x, y, sel) {
    const chips = [...zoneEl.querySelectorAll(sel || '.mq-chip')].filter((c) => c !== d.chip);
    for (let i = 0; i < chips.length; i++) {
      const r = chips[i].getBoundingClientRect();
      if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) return i;
    }
    return chips.length;
  }

  function drop(d, zone, index) {
    if (d.kind === 'pools') draft.poolsSide = zone === 'pools-bottom' ? 'bottom' : 'top';
    else if (d.kind === 'row') moveRow(d.id, index);
    else if (zone === 'pools-order') moveInPools(d.id, index);
    else if (d.kind === 'module') moveModule(d.id, zone, index);
    renderPreview();
    scheduleApply();
  }

  /* Réordonne les modules à associer depuis la mini-grille des Réserves.
     Un module informatif déposé dans les Réserves devient « à associer ». */
  function moveInPools(id, index) {
    const m = draft.modules.find((x) => x.id === id);
    if (!m) return;
    if (m.role !== 'associate') {
      m.role = 'associate';
      delete m.zone;
    }
    const members = draft.modules.filter((x) => x.role === 'associate');
    members.splice(members.indexOf(m), 1);
    const at = members[Math.max(0, Math.min(index, members.length))];
    draft.modules = draft.modules.filter((x) => x !== m);
    if (!at) draft.modules.push(m);
    else draft.modules.splice(draft.modules.indexOf(at), 0, m);
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
