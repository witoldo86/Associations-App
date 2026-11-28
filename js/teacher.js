/* js/teacher.js */
(function () {
  const App = window.App;
  const T = (App.teacher = {});
  const esc = App.utils.escapeHtml;

  let root = null;
  let editingRowId = null;
  let selectedRowId = null;
  let editingModuleId = null;
  let editingCellCtx = null;
  let flattenedRowIds = new Set();
  let rowsView = (() => {
    try { return localStorage.getItem('assoc3-rows-view') === 'compact' ? 'compact' : 'modules'; }
    catch (e) { return 'modules'; }
  })();

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => [...root.querySelectorAll(sel)];

  /* Source affichable : « media:<clé> » -> URL de blob (js/media.js). */
  function resolveSrc(src) {
    if (App.media && typeof App.media.resolve === 'function') return App.media.resolve(src);
    return src;
  }

  function cfg() { return App.state.config(); }
  function assocMods() { return cfg().modules.filter((m) => m.role === 'associate'); }
  function allMods()   { return cfg().modules; }

  /* =========================================================
     MONTAGE
     ========================================================= */
  /* Gestion des modules pilotée depuis la maquette (js/maquette.js) */
  T.addModule = function (zone) { startAddModule(zone); };
  T.editModule = startEditModule;
  T.moduleContents = showModuleContents;
  T.removeModule = deleteModule;

  /* =========================================================
     DIALOGUES RAPIDES DEPUIS LA MAQUETTE (boutons ✎ et ⌗)
     ========================================================= */
  const gridNLocal = (v) => { v = Math.floor(Number(v)); return v >= 1 && v <= 4 ? v : 0; };
  const cloneData = (o) => JSON.parse(JSON.stringify(o));

  function openTextDialog(kind) {
    const isTitle = kind !== 'subtitle';
    const c = cfg();
    const t = c.theme || {};
    const sizes = isTitle ? App.theme.TITLE_SIZES : App.theme.SUBTITLE_SIZES;
    const sizeKey = isTitle ? 'titleSize' : 'subtitleSize';
    const value = isTitle ? (c.title || '') : (c.subtitle || '');
    const sizeVal = App.theme.resolve(t)[sizeKey];
    const fontKey = isTitle ? 'titleFont' : 'subtitleFont';
    const ownFont = t[fontKey] || '';
    /* Seule la police du paramètre concerné ; la police d'interface reste
       le réglage global par défaut (elle se règle dans chaque éditeur riche). */
    const fontOpts = Object.keys(App.theme.FONTS).map((k) =>
      '<option value="' + k + '"' + (k === ownFont ? ' selected' : '') + '>' +
      esc(App.theme.FONTS[k].label) + '</option>').join('');
    const ownFontOpts = '<option value=""' + (!ownFont ? ' selected' : '') + '>' +
      'Par défaut (syst\u00e8me)</option>' + fontOpts;
    const sizeOpts = Object.keys(sizes).map((k) =>
      '<option value="' + k + '"' + (k === sizeVal ? ' selected' : '') + '>' +
      esc(sizes[k].label) + '</option>').join('');

    const contentField = isTitle
      ? '<input id="tx-content" type="text" value="' + esc(value) + '">'
      : '<div class="rte" data-rte-module="__subtitle__" data-rte-field="subtitle">' +
          rteToolbarHtml() +
          '<div class="rte-editor" contenteditable="true" ' +
          'data-placeholder="Consigne (ce que verra l\u2019\u00e9l\u00e8ve)">' + rteEditorHtml(value) + '</div>' +
        '</div>';

    App.modal.open({
      title: isTitle ? 'Modifier le titre' : 'Modifier la consigne',
      html:
        '<form id="tx-form" novalidate onsubmit="return false">' +
          '<div class="field"><label for="tx-content">' +
            (isTitle ? 'Titre' : 'Consigne (ce que verra l\u2019\u00e9l\u00e8ve)') + '</label>' +
            contentField + '</div>' +
          '<div class="inline">' +
            '<div class="field"><label for="tx-size">Taille</label>' +
              '<select id="tx-size">' + sizeOpts + '</select></div>' +
            (isTitle
              ? '<div class="field field-auto"><label for="tx-color">Couleur</label><span class="inline">' +
                '<input id="tx-color" type="color" value="' +
                esc(t.titleColor || t.ink || '#1f2937') + '">' +
                '<button type="button" class="btn link" id="tx-color-auto">Auto</button></span></div>'
              : '') +
            '<div class="field"><label for="tx-tfont">Police ' +
              (isTitle ? 'du titre' : 'de la consigne') + '</label>' +
              '<select id="tx-tfont">' + ownFontOpts + '</select></div>' +
          '</div>' +
          '<div class="form-actions">' +
            '<button type="button" class="btn" data-close>Fermer</button>' +
            '<button type="button" class="btn primary" id="tx-save">Appliquer</button>' +
          '</div>' +
        '</form>'
    });

    let autoColor = false;
    const colorInput = document.getElementById('tx-color');
    if (isTitle) {
      document.getElementById('tx-color-auto').addEventListener('click', () => {
        autoColor = true;
        colorInput.value = t.ink || '#1f2937';
      });
      colorInput.addEventListener('input', () => { autoColor = false; });
    }
    document.getElementById('tx-save').addEventListener('click', () => {
      const c2 = cloneData(cfg());
      c2.theme = Object.assign({}, c2.theme, {
        [sizeKey]: document.getElementById('tx-size').value,
        [fontKey]: document.getElementById('tx-tfont').value
      });
      if (isTitle) {
        c2.title = String(document.getElementById('tx-content').value).trim();
        c2.theme.titleColor = autoColor ? '' : (colorInput.value || '');
      } else {
        const editor = document.querySelector(
          '[data-rte-module="__subtitle__"][data-rte-field="subtitle"] .rte-editor');
        const raw = editor ? editor.innerHTML : '';
        const withRefs = App.utils.htmlWithMediaRefs ? App.utils.htmlWithMediaRefs(raw) : raw;
        c2.subtitle = App.utils.sanitizeRich(withRefs);
      }
      c2.theme = App.theme.resolve(c2.theme);
      App.state.updateConfig(c2);
      App.modal.close();
    });
    bindFieldEvents(document.getElementById('tx-form'));
    const focusEl = isTitle
      ? document.getElementById('tx-content')
      : document.querySelector('[data-rte-module="__subtitle__"] .rte-editor');
    if (focusEl) focusEl.focus();
  }

  /* Position des panneaux d'information : plateau (défaut), réserves,
     ou pleine hauteur (les deux) — les anciens réglages sont convertis. */
  function asideModeLocal(l) {
    if (l && l.infosAside) return String(l.infosAside);
    return (l && l.infosBesidePools) ? 'pools' : 'board';
  }

  function openGridDialog() {
    const l = cfg().layout || {};
    const opts = (cur) => '<option value="0"' + (!cur ? ' selected' : '') +
        '>Tous sur une ligne</option>' +
      [1, 2, 3, 4].map((n) => '<option value="' + n + '"' + (cur === n ? ' selected' : '') +
        '>' + n + ' par ligne</option>').join('');
    App.modal.open({
      title: 'Grille des modules',
      html:
        '<form id="grid-form" novalidate>' +
          '<div class="field"><label for="gd-board">Plateau : modules par ligne</label>' +
            '<select id="gd-board">' + opts(gridNLocal(l.boardCols)) + '</select></div>' +
          '<div class="field"><label for="gd-pools">Réserves : modules par ligne</label>' +
            '<select id="gd-pools">' + opts(gridNLocal(l.poolsCols)) + '</select></div>' +
          '<div class="field"><label for="gd-infos">Panneaux d\'information — position</label>' +
            '<select id="gd-infos">' +
              '<option value="board"' + (asideModeLocal(l) === 'board' ? ' selected' : '') + '>À gauche et à droite du plateau (défaut)</option>' +
              '<option value="pools"' + (asideModeLocal(l) === 'pools' ? ' selected' : '') + '>À gauche et à droite des réserves</option>' +
              '<option value="both"' + (asideModeLocal(l) === 'both' ? ' selected' : '') + '>Pleine hauteur — à côté des réserves et du plateau</option>' +
            '</select></div>' +
          '<div class="field"><label for="gd-infocols">Panneaux d\'information — modules par ligne</label>' +
            '<select id="gd-infocols">' +
              '<option value="1"' + (!l.infoCols || l.infoCols <= 1 ? ' selected' : '') + '>Empilés — un par ligne (défaut)</option>' +
              '<option value="2"' + (l.infoCols === 2 ? ' selected' : '') + '>2 par ligne</option>' +
              '<option value="3"' + (l.infoCols === 3 ? ' selected' : '') + '>3 par ligne</option>' +
            '</select></div>' +
          '<div class="field"><label for="gd-rewards">Récompenses visuelles</label>' +
            '<select id="gd-rewards">' +
              '<option value="off"' + (!l.rewards || l.rewards === 'off' || l.rewards === false ? ' selected' : '') + '>Aucune</option>' +
              '<option value="on"' + (l.rewards === 'on' || l.rewards === true ? ' selected' : '') + '>À chaque ligne complétée (même intensité)</option>' +
              '<option value="progressive"' + (l.rewards === 'progressive' ? ' selected' : '') + '>Intensité selon la réussite de la combinaison</option>' +
            '</select></div>' +
          '<p class="hint" id="gd-rewards-hint" hidden>Choisissez d\'abord un mode de récompenses ci-dessus (sinon aucun effet ne s\'affiche).</p>' +
          '<div class="field gd-reward-extra"><label for="gd-rewards-fx">Type d\'effets (pack)</label>' +
            '<select id="gd-rewards-fx">' +
              '<option value="fireworks"' + (!l.rewardsFx || l.rewardsFx === 'fireworks' ? ' selected' : '') + '>Feux d\'artifice (par défaut)</option>' +
              '<option value="confetti"' + (l.rewardsFx === 'confetti' ? ' selected' : '') + '>Confettis — pluie colorée</option>' +
              '<option value="stars"' + (l.rewardsFx === 'stars' ? ' selected' : '') + '>Étoiles</option>' +
              '<option value="nature"' + (l.rewardsFx === 'nature' ? ' selected' : '') + '>Nature — fleurs et papillons</option>' +
              '<option value="museum"' + (l.rewardsFx === 'museum' ? ' selected' : '') + '>Musée — poussière dorée</option>' +
            '</select></div>' +
          '<label class="inline gd-reward-extra" style="gap:.45rem">' +
            '<input id="gd-rewards-end" type="checkbox"' + (l.rewardsEnd === false ? '' : ' checked') + '>' +
            'Écran de fin : score, étoiles (1 à 3) et message quand tout est terminé' +
          '</label>' +
          '<div class="field gd-reward-extra"><label for="gd-rewards-msg">Message de félicitations (écran de fin)</label>' +
            '<input id="gd-rewards-msg" type="text" value="' + esc(l.rewardsMessage || '') + '" placeholder="Bravo, tu as tout trouvé !"></div>' +
          '<p class="hint">Le <strong>plateau</strong> est la zone où l’élève dépose ses réponses ; ' +
            'les <strong>réserves</strong> sont les bacs d’où il pioche les éléments. ' +
            'Dans chaque ligne, les largeurs réglées avec les poignées sont conservées.</p>' +
          '<div class="form-actions">' +
            '<button type="button" class="btn" data-close>Fermer</button>' +
            '<button type="button" class="btn primary" id="gd-save">Appliquer</button>' +
          '</div>' +
        '</form>'
    });
    /* Les options (pack, écran de fin, message) n'ont de sens que si un
       mode de récompenses est actif : on les grise sinon, avec un rappel. */
    const rewardsSel = document.getElementById('gd-rewards');
    const syncRewardsUI = () => {
      const off = !rewardsSel || rewardsSel.value === 'off';
      ['gd-rewards-fx', 'gd-rewards-end', 'gd-rewards-msg'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = off;
      });
      document.querySelectorAll('.gd-reward-extra').forEach((el) =>
        el.classList.toggle('is-disabled', off));
      const hint = document.getElementById('gd-rewards-hint');
      if (hint) hint.hidden = !off;
    };
    if (rewardsSel) rewardsSel.addEventListener('change', syncRewardsUI);
    syncRewardsUI();

    document.getElementById('gd-save').addEventListener('click', () => {
      const c2 = cloneData(cfg());
      c2.layout = Object.assign({}, c2.layout, {
        boardCols: gridNLocal(document.getElementById('gd-board').value),
        poolsCols: gridNLocal(document.getElementById('gd-pools').value),
        infosAside: document.getElementById('gd-infos').value,
        infosBesidePools: document.getElementById('gd-infos').value === 'pools',
        infoCols: (function () {
          const n = Number(document.getElementById('gd-infocols').value);
          return (n === 2 || n === 3) ? n : 1;
        })(),
        rewards: (function () {
          const el = document.getElementById('gd-rewards');
          const v = el ? el.value : 'off';
          return (v === 'on' || v === 'progressive') ? v : 'off';
        })(),
        rewardsFx: (function () {
          const v = document.getElementById('gd-rewards-fx') ?
            document.getElementById('gd-rewards-fx').value : 'fireworks';
          return ['fireworks','confetti','stars','nature','museum'].indexOf(v) !== -1 ? v : 'fireworks';
        })(),
        rewardsEnd: !(document.getElementById('gd-rewards-end') && !document.getElementById('gd-rewards-end').checked),
        rewardsMessage: (function () {
          const el = document.getElementById('gd-rewards-msg');
          return el ? el.value.trim() : '';
        })()
      });
      App.state.updateConfig(c2);
      App.modal.close();
    });
  }

  T.openTextDialog = openTextDialog;
  T.openGridDialog = openGridDialog;

  T.mount = function (container) {
    root = container;
    root.innerHTML = tpl();
    bind();
    renderAll();
    App.state.onChange(() => renderAll());
    if (App.maquette) App.maquette.mount($('#maquette-panel'));
  };

  function tpl() {
    return `
    <div class="teacher">
      <section class="panel" id="maquette-panel"></section>
      ${panelConfig()}
      ${panelRows()}
    </div>`;
  }

  /* =========================================================
     PANNEAU CONFIG
     ========================================================= */
  function panelConfig() {
    return `
    <section class="panel">
      <h2>Options de l'exercice</h2>
      <div class="inline">
        <div class="field">
          <label for="cfg-scoring">Calcul du score</label>
          <select id="cfg-scoring">
            <option value="all-or-nothing">Ligne entière juste = 1 point</option>
            <option value="pairs">1 point par paire correcte</option>
            <option value="weighted">Pondéré par module</option>
          </select>
        </div>
        <div class="field">
          <label for="cfg-imgmodal">Format de la fenêtre d'image (élève)</label>
          <select id="cfg-imgmodal">
            <option value="fullscreen">Quasi plein écran (recommandé)</option>
            <option value="compact">Compact (ajusté à l'image)</option>
          </select>
        </div>
      </div>
      <p class="hint">Titre, couleurs, polices et disposition se règlent dans la maquette ci-dessus.</p>
      <div class="form-actions">
        <button type="button" class="btn primary" id="cfg-save">Enregistrer les options</button>
      </div>
    </section>`;
  }

  /* Remplit le formulaire depuis l'état (montage, import, effacement…) */
  function syncConfigForm() {
    const c = cfg();
    $('#cfg-scoring').value = (c.scoring && c.scoring.mode) || 'all-or-nothing';
    $('#cfg-imgmodal').value = (c.layout && c.layout.imageModal) || 'fullscreen';
  }

  function saveConfig() {
    const c = cfg();
    c.scoring = Object.assign({}, c.scoring, { mode: $('#cfg-scoring').value });
    c.layout = Object.assign({}, c.layout, { imageModal: $('#cfg-imgmodal').value });
    App.state.updateConfig(c);
    alert('Options enregistrées.');
  }

  /* =========================================================
     PANNEAU MODULES
     ========================================================= */
  function deleteModule(id) {
    const c = cfg();
    const mod = c.modules.find((m) => String(m.id) === String(id));
    if (!mod) return;
    if (!confirm('Supprimer le module « ' + (mod.label || mod.id) + ' » ? Les données associées deviendront invisibles (mais non supprimées).')) return;
    c.modules = c.modules.filter((m) => String(m.id) !== String(id));
    c.modules.forEach((m) => {
      if (Array.isArray(m.unlockAfter)) {
        m.unlockAfter = m.unlockAfter.filter((x) => String(x) !== String(id));
      }
    });
    App.state.updateConfig(c);
  }

  /* =========================================================
     FORMULAIRE MODULE — dans une MODAL
     ========================================================= */
  function startAddModule(zone) {
    editingModuleId = null;
    openModuleModal(null, zone);
  }

  function startEditModule(id) {
    const m = allMods().find((x) => x.id === id);
    if (!m) return;
    editingModuleId = id;
    openModuleModal(m);
  }

  function openModuleModal(m, zone) {
    App.modal.open({
      title: m ? 'Modifier le module : ' + (m.label || m.id) : 'Nouveau module',
      html: moduleFormHtml(m, zone)
    });
    const idInput = document.getElementById('mf-id');
    if (idInput && !idInput.readOnly) idInput.focus();
    bindModuleForm();
  }

  function moduleFormHtml(m, zone) {
    const isNew = !m;
    const kinds = Object.entries(App.schema.Types);
    const others = allMods().filter((x) => !m || x.id !== m.id);
    const unlockSet = new Set((m && m.unlockAfter) || []);
    /* Zone présélectionnée quand l'ajout part de la maquette : « à associer »
       (plateau, réserve) ou « informatif » (panneau gauche/droit, masqué). */
    const zoneOk = isNew && ['columns', 'pools', 'left', 'right', 'hidden'].indexOf(zone) !== -1;
    const presetRole = zoneOk ? (zone === 'columns' || zone === 'pools' ? 'associate' : 'informative') : null;

    /* Apparition conditionnelle des modules informatifs : dès qu'une des
       lignes cochées est complétée par l'élève. */
    const isInfo = isNew ? presetRole === 'informative' : m.role === 'informative';
    const rowList = isNew || isInfo ? App.state.rows() : [];
    const revealSet = new Set((m && Array.isArray(m.revealRows)) ? m.revealRows.map(String) : []);
    const assocAll = allMods().filter((x) => x.role === 'associate');
    /* Le prof pointe un agencement : on montre TOUS les blocs de la ligne. */
    const rowLabelOf = (r, i) => {
      const parts = assocAll.map((mm) => {
        const vt = App.schema.Types[mm.kind];
        if (!vt || !r.cells || r.cells[mm.id] == null) return '';
        let s = String(vt.summary(r.cells[mm.id]) || '');
        if (s.length > 20) s = s.slice(0, 20) + '…';
        return s;
      }).filter(Boolean);
      return 'Ligne ' + (i + 1) + (parts.length ? ' — ' + parts.join(' · ') : ' (vide)');
    };
    const revealBlock = isInfo
      ? `<fieldset class="module-fieldset">
          <legend>Apparition du panneau (optionnel)</legend>
          <div class="hint" style="margin-bottom:.3rem">Le panneau d'information apparaît dès que l'élève a réalisé, sur n'importe
            quelle ligne du plateau, l'agencement exact des éléments de l'une des lignes cochées ici.
            Et/ou après avoir consulté les éléments des modules
            cochés dans le « Verrouillage pédagogique » ci-dessus. Sans coche : visible dès le début.
            ${rowList.length ? '' : 'Créez d’abord des lignes pour pouvoir les cocher.'}</div>
          <div class="inline">
          ${rowList.map((r, i) => `
            <label class="inline" style="gap:.3rem">
              <input type="checkbox" data-reveal-row="${esc(String(r.id))}" ${revealSet.has(String(r.id)) ? 'checked' : ''}>
              ${esc(rowLabelOf(r, i))}
            </label>`).join('')}
          </div>
        </fieldset>`
      : '';

    /* L'option « cliquable » ne concerne que les modules informatifs :
       elle est grisée (désactivée) tant que le rôle n'est pas « Informatif »,
       et réactivée en direct si le prof change le rôle. */
    const currentRole = m ? m.role : (presetRole || 'associate');

    /* Verrouillage pédagogique : on distingue clairement les conditions liées
       aux réserves (modules « à associer ») de celles liées aux panneaux
       d'information (modules informatifs), et on ajoute la condition
       « mot de passe » (l'élève doit le saisir dans une fenêtre). */
    const othersAssoc = others.filter((o) => o.role === 'associate');
    const othersInfo = others.filter((o) => o.role === 'informative');
    const lockChecks = (list, emptyText) => list.map((o) => `
            <label class="inline" style="gap:.3rem">
              <input type="checkbox" data-unlock="${esc(o.id)}" ${unlockSet.has(o.id)?'checked':''}>
              ${esc(o.label || o.id)}
            </label>`).join('') || '<span class="hint">' + emptyText + '</span>';
    const lockBlock = `
      <fieldset class="module-fieldset" id="mf-unlock-fieldset">
        <legend>Verrouillage pédagogique (optionnel)</legend>
        <div class="hint" style="margin-bottom:.3rem">Conditions à remplir avant que ce module soit accessible
          (ou avant qu'il apparaisse, s'il s'agit d'un panneau d'information).
          Plusieurs conditions peuvent être cochées : elles s'ajoutent.</div>
        <div class="mf-lock-group">
          <div class="mf-lock-title">Avant tout — les réserves (modules « à associer »)</div>
          <div class="hint" style="margin-bottom:.3rem">L'élève doit d'abord avoir ouvert tous les éléments des réserves cochées.</div>
          <div class="inline">${lockChecks(othersAssoc, 'Aucun module « à associer » pour le moment.')}</div>
        </div>
        <div class="mf-lock-group">
          <div class="mf-lock-title">Les panneaux d'information (modules informatifs)</div>
          <div class="hint" style="margin-bottom:.3rem">L'élève doit d'abord avoir consulté le contenu des panneaux cochés.</div>
          <div class="inline">${lockChecks(othersInfo, 'Aucun module informatif pour le moment.')}</div>
        </div>
        <div class="mf-lock-group">
          <div class="mf-lock-title">Mot de passe</div>
          <label class="inline" style="gap:.45rem">
            <input id="mf-pw-on" type="checkbox" ${m && m.password ? 'checked' : ''}>
            Exiger un mot de passe pour ouvrir ce module
          </label>
          <div class="field" id="mf-pw-field">
            <label for="mf-password">Mot de passe (visible ici — côté élève, il devra le saisir dans une fenêtre)</label>
            <input id="mf-password" type="text" value="${esc((m && m.password) || '')}" placeholder="ex. 1725" autocomplete="off">
          </div>
          <span class="hint">Ce mot de passe est une clé pédagogique (donnée visible dans l'exercice),
            pas une protection de confidentialité.</span>
        </div>
      </fieldset>`;

    /* Onglet « Contenu du pool » : vue d'ensemble en lecture seule des
       contenus déjà saisis (mêmes éléments que la fenêtre 📄 de la maquette). */
    const overviewHtml = isNew
      ? '<p class="hint">Enregistrez d\'abord le module (bouton « Ajouter ») pour pouvoir saisir son contenu.</p>'
      : (m.role === 'informative'
        ? '<div class="module-contents"><div class="mini-info-head">Contenu du panneau d\'information</div>' +
          '<div class="mini-info">' + esc(String(infoOverviewSummary(m)).slice(0, 400)) + '</div>' +
          '<p class="hint">Un seul contenu, indépendant des lignes — éditez-le avec le bouton ' +
          '\ud83d\udcdd du bloc dans la maquette, ou via la fenêtre de visualisation des contenus.</p></div>'
        : '<div class="module-contents">' + moduleItemsHtml(m).html + '</div>');

    return `
    <div class="modal-tabs" id="mf-tabs" role="tablist">
      <button type="button" class="modal-tab is-active" data-tab="module">Module</button>
      <button type="button" class="modal-tab" data-tab="present">Présentation</button>
      <button type="button" class="modal-tab" data-tab="contents">Contenu du pool</button>
    </div>
    <form id="module-form" novalidate>
      <input id="mf-zone" type="hidden" value="${zoneOk ? esc(zone) : ''}">
      <div class="modal-tabpane is-active" data-pane="module">
      <div class="inline">
        <div class="field">
          <label>Identifiant technique (facultatif — déduit du libellé si vide)</label>
          <input id="mf-id" type="text" value="${esc(m?m.id:'')}" ${isNew?'':'readonly'}
                 placeholder="généré automatiquement" pattern="[a-zA-Z0-9_\\-]+">
        </div>
        <div class="field">
          <label>Libellé (affiché à l'élève)</label>
          <input id="mf-label" type="text" value="${esc(m?m.label:'')}" placeholder="ex. Son">
        </div>
      </div>
      <div class="inline">
        <div class="field">
          <label>Type de contenu</label>
          <select id="mf-kind">
            ${kinds.map(([k, v]) => `<option value="${esc(k)}" ${m&&m.kind===k?'selected':''}>${esc(v.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Rôle</label>
          <select id="mf-role">
            <option value="associate" ${currentRole==='associate'?'selected':''}>À associer (colonne du plateau)</option>
            <option value="informative" ${currentRole==='informative'?'selected':''}>Informatif (panneau latéral)</option>
          </select>
        </div>
      </div>
      <div class="field" id="mf-clickable-row">
        <label class="inline" style="gap:.45rem">
          <input id="mf-clickable" type="checkbox" ${m && m.clickable ? 'checked' : ''}>
          Cliquable chez l'élève — ouvre le contenu en grand dans une fenêtre
          (uniquement pour les modules informatifs des panneaux latéraux)
        </label>
      </div>
      ${revealBlock}
      ${lockBlock}
      </div>
      <div class="modal-tabpane" data-pane="present" hidden>
      <div class="field">
        <label>Éléments par ligne dans le bac (réserves)</label>
        <select id="mf-poolcols">
          <option value="" ${!(m&&m.poolCols)?'selected':''}>Auto — ils remplissent la largeur du bac</option>
          ${[1,2,3,4].map((n) => '<option value="' + n + '" ' + (m && m.poolCols === n ? 'selected' : '') + '>' + n + ' par ligne (contenu adapté)</option>').join('')}
        </select>
        <div class="mf-grid-preview" id="mf-grid-preview" title="Aperçu de la disposition dans le bac"></div>
        <div class="hint" style="margin-top:.3rem">Miniature indicative : la disposition réelle dépend aussi
          de la largeur du bac et des largeurs réglées dans la maquette.</div>
      </div>
      <div class="field">
        <label>Couleur de fond du bac (réserves de l'élève)</label>
        <div class="inline" style="gap:.5rem; align-items:center">
          <input id="mf-poolcolor" type="color" value="${esc((m && m.poolColor) || '#ffffff')}" style="width:2.4rem; height:1.6rem; padding:0">
          <button type="button" class="btn" id="mf-poolcolor-clear" title="Revenir à la couleur par défaut (aucune teinte)">Par défaut</button>
        </div>
      </div>
      <div class="field" id="mf-pooltitle-row">
          <label class="inline" style="gap:.45rem">
            <input id="mf-pooltitle" type="checkbox" ${m && m.kind === 'richtext' && m.poolTitleOnly ? 'checked' : ''}>
            N'afficher que le titre dans les réserves de l'élève — pour un module
            de texte enrichi (un clic sur le titre ouvre le contenu)
          </label>
          <label class="inline" style="gap:.45rem">
            <input id="mf-pooltitlestyle" type="checkbox" ${m && m.kind === 'richtext' && m.poolTitleStyle ? 'checked' : ''}>
            Dans les réserves, les éléments reprennent la mise en forme du titre
            (taille, police, gras, italique, surlignage…)
          </label>
          <span class="hint">Sans cette coche, les éléments des réserves restent
            neutres. La couleur de l'étiquette, elle, colore toujours le bandeau
            de la fenêtre de lecture — jamais le texte des réserves (un titre
            surligné reste lisible).</span>
        </div>
      ${isInfo ? `<div class="field">
          <label>Affichage du panneau d'information</label>
          <select id="mf-infomode">
            <option value="full" ${(m && m.infoMode !== 'title') ? 'selected' : ''}>Tout le contenu, déplié dans le panneau</option>
            <option value="title" ${(m && m.infoMode === 'title') ? 'selected' : ''}>Seulement le titre — un clic ouvre la fenêtre du contenu</option>
          </select>
        </div>
        <p class="hint">Contenu informatif : un seul contenu, indépendant des lignes, édité avec le bouton \ud83d\udcdd du bloc dans la maquette.</p>` : ''}
      </div>
      <div class="modal-tabpane" data-pane="contents" hidden>
        ${overviewHtml}
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary" id="mf-save">${isNew ? 'Ajouter' : 'Enregistrer'}</button>
        <button type="button" class="btn" id="mf-cancel">Annuler</button>
      </div>
    </form>`;
  }

  /* Résumé du contenu d'un module informatif (onglet « Contenu du pool »). */
  function infoOverviewSummary(m) {
    const type = App.schema.Types[m.kind];
    const v = m.data;
    if (v == null || (type.validate && !type.validate(v))) return '(vide)';
    return type.summary(v) || '(contenu)';
  }

  function bindModuleForm() {
    document.getElementById('mf-save').addEventListener('click', saveModule);
    document.getElementById('mf-cancel').addEventListener('click', hideModuleForm);
    document.getElementById('module-form').addEventListener('submit', (e) => {
      e.preventDefault();
      saveModule();
    });
    /* Navigation entre onglets (Module / Présentation / Contenu du pool). */
    const tabs = document.getElementById('mf-tabs');
    if (tabs) tabs.addEventListener('click', (e) => {
      const b = e.target.closest('.modal-tab');
      if (!b) return;
      tabs.querySelectorAll('.modal-tab').forEach((x) => x.classList.toggle('is-active', x === b));
      document.querySelectorAll('#module-form .modal-tabpane').forEach((p) => {
        const active = p.dataset.pane === b.dataset.tab;
        p.classList.toggle('is-active', active);
        p.hidden = !active;
      });
    });
    /* L'option « cliquable » ne vaut que pour les modules informatifs :
       grisée tant que le rôle n'est pas « Informatif ». */
    const roleSel = document.getElementById('mf-role');
    const clickCb = document.getElementById('mf-clickable');
    const clickRow = document.getElementById('mf-clickable-row');
    const syncClickable = () => {
      const info = roleSel.value === 'informative';
      if (clickCb) clickCb.disabled = !info;
      if (clickRow) {
        clickRow.classList.toggle('is-disabled', !info);
        clickRow.title = info ? '' : 'Option réservée aux modules informatifs (panneaux latéraux) — le rôle est « À associer ».';
      }
    };
    if (roleSel) roleSel.addEventListener('change', syncClickable);
    syncClickable();
    /* Miniature de la disposition (onglet Présentation) : mise à jour en direct. */
    const colsSel = document.getElementById('mf-poolcols');
    if (colsSel) colsSel.addEventListener('change', renderGridPreview);
    renderGridPreview();
    /* Couleur de fond du bac : bouton « Par défaut » = blanc, aucune teinte. */
    const pcClear = document.getElementById('mf-poolcolor-clear');
    if (pcClear) pcClear.addEventListener('click', () => {
      const pc = document.getElementById('mf-poolcolor');
      if (pc) pc.value = '#ffffff';
    });
  }

  /* Miniature de l'onglet Présentation : montre la disposition des éléments
     du bac selon le choix « éléments par ligne » (Auto / 1 à 4). */
  function renderGridPreview() {
    const box = document.getElementById('mf-grid-preview');
    const sel = document.getElementById('mf-poolcols');
    if (!box || !sel) return;
    const me = editingModuleId;
    const assoc = allMods().filter((x) => x.role === 'associate' && (!me || x.id !== me));
    const n = Number(sel.value) || 0;
    const cells = assoc.map((mm) => ({ label: mm.label || mm.id, self: false }));
    cells.push({ label: 'Ce module', self: true });
    box.classList.toggle('is-grid', n >= 1 && cells.length > 1);
    box.style.gridTemplateColumns = n >= 1 ? 'repeat(' + n + ', 1fr)' : '';
    box.innerHTML = cells.map((c) =>
      '<span class="mf-grid-box' + (c.self ? ' is-self' : '') + '" title="' + esc(c.label) + '">' +
      esc(c.label) + '</span>').join('');
  }

  function hideModuleForm() {
    App.modal.close();
    editingModuleId = null;
  }

  function convertCellValue(fromKind, toKind, val) {
    if (fromKind === toKind) return val;
    const targetType = App.schema.Types[toKind];
    if (!targetType) return val;

    // Texte simple -> Texte enrichi : copie le texte dans html (et title si court)
    if (fromKind === 'text' && toKind === 'richtext') {
      const str = typeof val === 'string' ? val.trim() : '';
      if (!str) return targetType.createEmpty();
      const safe = esc(str);
      return {
        title: '',
        html: `<p>${safe}</p>`
      };
    }

    // Texte enrichi -> Texte simple : extrait le texte brut
    if (fromKind === 'richtext' && toKind === 'text') {
      if (!val || typeof val !== 'object') return '';
      const plain = App.utils.stripHtml(val.html);
      return plain || String(val.title || '').trim();
    }

    // Autres changements de type : valeur vide propre du nouveau type
    return targetType.createEmpty();
  }

  /* Identifiant technique déduit du libellé, sans accents ni espaces. */
  function slugFromLabel(label) {
    const s = String(label).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
    return s || 'module';
  }

  function saveModule() {
    const rawId = document.getElementById('mf-id').value.trim();
    const label = document.getElementById('mf-label').value.trim();
    const kind = document.getElementById('mf-kind').value;
    const role = document.getElementById('mf-role').value;
    const unlockAfter = [...document.querySelectorAll('input[data-unlock]:checked')]
      .map((x) => x.dataset.unlock);

    if (!label) { alert('Donnez un libellé au module (ce que verra l\'élève).'); return; }

    let id = rawId;
    if (!id) id = slugFromLabel(label);
    if (!/^[a-zA-Z0-9_\-]+$/.test(id)) { alert('Identifiant : lettres, chiffres, _ et - uniquement.'); return; }

    const c = cfg();
    const isNew = !editingModuleId;

    if (isNew && c.modules.some((m) => m.id === id)) {
      if (rawId) { alert('Cet identifiant existe déjà.'); return; }
      let n = 2;
      while (c.modules.some((m) => m.id === id + '-' + n)) n++;
      id = id + '-' + n;
    }

    const poolColsRaw = document.getElementById('mf-poolcols').value;
    const clickableEl = document.getElementById('mf-clickable');
    const revealChecked = [...document.querySelectorAll('input[data-reveal-row]:checked')]
      .map((x) => x.dataset.revealRow);
    const poolTitleEl = document.getElementById('mf-pooltitle');
    /* Mot de passe (verrouillage pédagogique) : actif seulement si la case
       est cochée ET qu'un mot de passe non vide est saisi. */
    const pwOnEl = document.getElementById('mf-pw-on');
    const pwEl = document.getElementById('mf-password');
    const password = (pwOnEl && pwOnEl.checked && pwEl) ? pwEl.value.trim() : '';
    /* Couleur de fond du bac (onglet Présentation) : '' = pas de teinte.
       Appliquée côte élève via --pool-color ; le bouton 🎨 des réserves
       disparaît de la maquette — c'est ici qu'on la règle désormais. */
    const poolColorEl = document.getElementById('mf-poolcolor');
    const poolColorRaw = poolColorEl ? String(poolColorEl.value || '').trim().toLowerCase() : '';
    /* Blanc = aucune teinte (fond par défaut déjà blanc) */
    const poolColor = (poolColorRaw && poolColorRaw !== '#ffffff') ? poolColorRaw : '';
    const payload = { id, label, kind, role, unlockAfter,
      poolCols: poolColsRaw ? Number(poolColsRaw) : null,
      poolColor: role === 'associate' ? poolColor : '',
      poolTitleOnly: kind === 'richtext' && !!(poolTitleEl && poolTitleEl.checked),
      poolTitleStyle: kind === 'richtext' &&
        !!(document.getElementById('mf-pooltitlestyle') && document.getElementById('mf-pooltitlestyle').checked),
      clickable: !!(clickableEl && clickableEl.checked),
      password,
      /* Panneau informatif visible dès qu'une des lignes cochées est
         complétée (ou des éléments consultés, via le verrou) ; liste
         vide = toujours visible. */
      revealRows: role === 'informative' ? revealChecked : [],
      infoMode: role === 'informative' && document.getElementById('mf-infomode') &&
        document.getElementById('mf-infomode').value === 'title' ? 'title' : 'full' };

    if (editingModuleId == null) {
      const zoneEl = document.getElementById('mf-zone');
      const z = zoneEl ? zoneEl.value : '';
      if (z) payload.zone = z;
    }

    if (isNew) {
      c.modules.push(payload);
    } else {
      const idx = c.modules.findIndex((m) => m.id === editingModuleId);
      if (idx < 0) { alert('Module introuvable.'); return; }

      const prevModule = c.modules[idx];
      const oldKind = prevModule.kind;

      if (oldKind !== kind) {
        App.state.rows().forEach((r) => {
          if (id in r.cells) {
            r.cells[id] = convertCellValue(oldKind, kind, r.cells[id]);
          }
        });
      }

      c.modules[idx] = Object.assign({}, prevModule, payload);
    }

    App.state.updateConfig(c);
    hideModuleForm();
    alert('Module enregistré. Pensez à réexporter data.js si vous utilisez la version portable.');
  }

  /* =========================================================
     APERÇU DES CONTENUS D'UN MODULE (modal)
     ========================================================= */
  /* Générateur d'éléments « contenus en place » : partagé entre la fenêtre
     📄 de la maquette (showModuleContents) et l'onglet « Contenu du pool »
     de la modale d'édition du module (vue d'ensemble en lecture seule). */
  function moduleItemsHtml(m) {
    const type = App.schema.Types[m.kind];
    const rows = App.state.rows();

    if (m.role === 'informative') {
      const v = m.data;
      const ok = v != null && type.validate && type.validate(v);
      const s = ok ? (type.summary(v) || '(contenu)') : '(vide)';
      return { count: ok ? 1 : 0,
        html: '<div class="mini-info-head">' + (ok ? 'Défini' : 'Vide') + '</div>' +
          '<div class="mini-info">' + esc(String(s).slice(0, 400)) + '</div>' };
    }

    let count = 0;
    const items = rows.map((r, rowIndex) => {
      const v = r.cells[m.id];
      const has = v != null && type.validate && type.validate(v);
      if (has) count++;
      const num = '<div class="mini-info-head">Ligne ' +
        (rowIndex + 1) +
        (has ? '' : ' <span class="muted">(vide)</span>') + '</div>';

      if (m.kind === 'image' && v && v.src) {
        const src = resolveSrc(v.src);
        return num + '<div class="mini-line">' +
          (src
            ? '<img class="mini" src="' + esc(src) + '" alt="">'
            : '<span class="mini-info muted">(média introuvable)</span>') +
          '<span class="mini-info">' + esc(v.caption || '(sans légende)') + '</span></div>';
      }
      if (m.kind === 'richtext' && v) {
        const txt = App.utils.stripHtml(v.html);
        /* Le titre est un texte enrichi (avec mise en forme) : on affiche
           son texte, jamais les balises (span style…). */
        const plainTitle = v.title ? App.utils.stripHtml(String(v.title)) : '';
        return num + '<div class="mini-info">' +
          (plainTitle ? '<strong>' + esc(plainTitle) + '</strong> ' : '') +
          esc(txt.slice(0, 160) || '(vide)') + '</div>';
      }
      if ((m.kind === 'audio' || m.kind === 'video') && v) {
        const pres = v.html ? App.utils.stripHtml(v.html) : '';
        return num + '<div class="mini-info">' +
          esc(v.caption || '(sans titre)') +
          (v.src && !/^https?:/i.test(v.src)
            ? ' <span class="muted">(fichier intégré)</span>'
            : ' <span class="muted">(' + esc(v.src || 'aucune source') + ')</span>') +
          (pres ? '<div class="muted">Présentation : ' + esc(pres.slice(0, 120)) + '</div>' : '') +
          '</div>';
      }
      if (m.kind === 'url' && v) {
        const pres = v.html ? App.utils.stripHtml(v.html) : '';
        return num + '<div class="mini-info">' +
          esc(v.caption || '(sans titre)') + ' — ' +
          (v.src ? '<a href="' + esc(v.src) + '" target="_blank" rel="noopener">' + esc(v.src) + '</a>' : '<span class="muted">(sans URL)</span>') +
          (pres ? '<div class="muted">Présentation : ' + esc(pres.slice(0, 120)) + '</div>' : '') +
          '</div>';
      }
      const s = v == null ? '' : (type.summary(v) || '');
      return num + '<div class="mini-info">' + esc(s || '(vide)') + '</div>';
    }).join('<hr>');
    return { count, html: items };
  }

  function showModuleContents(moduleId) {
    const m = allMods().find((x) => x.id === moduleId);
    if (!m) return;
    const rows = App.state.rows();

    if (m.role === 'informative') {
      const type = App.schema.Types[m.kind];
      const v = m.data;
      const ok = v != null && type.validate && type.validate(v);
      const s = ok ? (type.summary(v) || '(contenu)') : '(vide)';
      App.modal.open({
        title: (m.label || m.id) + ' — contenu du panneau',
        html: '<div class="module-contents">' +
          '<div class="mini-info-head">' + (ok ? 'Défini' : 'Vide') + '</div>' +
          '<div class="mini-info">' + esc(String(s).slice(0, 400)) + '</div></div>'
      });
      return;
    }

    const built = moduleItemsHtml(m);
    const count = built.count;
    const items = built.html;

    const uniformBtn = (m.kind === 'richtext' && rows.length > 1)
      ? '<div class="form-actions"><button type="button" class="btn" id="mc-uniform" ' +
        'title="Donner à tous les éléments la même mise en forme">🖌 Uniformiser le style de tous les éléments…</button></div>' : '';

    App.modal.open({
      title: (m.label || m.id) + ' — contenus en place (' + count + '/' + rows.length + ')',
      html: uniformBtn +
        '<div class="module-contents">' + (rows.length ? items : '<p class="hint">Aucune ligne pour le moment.</p>') + '</div>'
    });

    const ub = document.getElementById('mc-uniform');
    if (ub) ub.addEventListener('click', () => openUniformDialog(m.id));
  }


  /* =========================================================
     UNIFORMISER LE STYLE — tous les éléments d'une même réserve
     (bouton 🖌 de la fenêtre « contenus en place »). Le prof choisit
     l'élément modèle ; les autres reprennent sa mise en forme (taille,
     couleurs, alignement, interlignage, étiquette) en gardant leur texte.
     ========================================================= */
  function openUniformDialog(moduleId) {
    const m = allMods().find((x) => String(x.id) === String(moduleId));
    if (!m || m.kind !== 'richtext') return;
    const rows = App.state.rows();
    if (rows.length < 2) {
      alert('Il faut au moins deux éléments (lignes) pour uniformiser la mise en forme.');
      return;
    }
    const type = App.schema.Types.richtext;
    const opts = rows.map((r, i) => {
      const v = r.cells[m.id];
      const s = (v && v.title && App.utils.stripHtml(String(v.title))) ||
        type.summary(v) || '(vide)';
      return '<option value="' + esc(r.id) + '">Ligne ' + (i + 1) + ' — ' +
        esc(String(s).slice(0, 50)) + '</option>';
    }).join('');

    App.modal.open({
      title: 'Uniformiser le style — ' + (m.label || m.id),
      html:
        '<form id="uniform-form" novalidate onsubmit="return false">' +
        '<p class="hint">Choisissez l\'élément dont la mise en forme servira de modèle. ' +
        'Seront appliqués à <strong>tous</strong> les éléments de cette réserve : ' +
        'taille, couleur et position du titre, couleur de l\'étiquette (bandeau), ' +
        'et pour le contenu : taille, couleur de texte, surlignage, alignement et interlignage. ' +
        'Chaque élément garde son texte — et reste personnalisable ensuite.</p>' +
        '<div class="field"><label for="uf-row">Élément modèle</label>' +
        '<select id="uf-row">' + opts + '</select></div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn" data-close>Annuler</button>' +
          '<button type="button" class="btn primary" id="uf-apply">Appliquer à tous</button>' +
        '</div></form>'
    });

    document.getElementById('uf-apply').addEventListener('click', () => {
      const rid = document.getElementById('uf-row').value;
      const src = rows.find((r) => String(r.id) === String(rid));
      if (!src || !src.cells[m.id]) { alert('L\'élément modèle est vide.'); return; }
      const sig = src.cells[m.id];
      const bulk = rows
        .filter((r) => String(r.id) !== String(src.id) && r.cells[m.id])
        .map((r) => ({ id: r.id, cells: { [m.id]: App.schema.Types.richtext.uniformize(sig, r.cells[m.id]) } }));
      if (!bulk.length) { App.modal.close(); return; }
      App.state.updateRowsBulk(bulk);
      App.modal.close();
      renderRows();
      alert('Mise en forme appliquée à ' + bulk.length + ' élément' + (bulk.length > 1 ? 's' : '') +
        '. Chacun garde son texte et reste modifiable individuellement.');
    });
  }

  /* =========================================================
     CONTENU D'UN MODULE D'INFORMATION — fenêtre dédiée (bouton 📝)
     Un seul contenu par module, indépendant des lignes : édité dans
     les mêmes champs (zone de texte enrichi, image, média…) que les
     cellules, stocké une fois pour toutes dans la fiche du module.
     ========================================================= */
  function openInfoContents(moduleId) {
    const m = allMods().find((x) => String(x.id) === String(moduleId));
    if (!m || m.role !== 'informative') return;
    const type = App.schema.Types[m.kind];
    const value = m.data != null ? m.data : type.createEmpty();

    App.modal.open({
      title: 'Contenu d\'information : ' + (m.label || m.id),
      html:
        '<form id="info-form" novalidate onsubmit="return false">' +
        '<p class="hint">Un seul contenu pour ce panneau, indépendant des lignes. ' +
        'L\'affichage (tout déplié ou titre seul) se choisit dans la fenêtre ' +
        'du module (bouton ✎ de la maquette).</p>' +
        renderModuleFieldset(m, value) +
        '<div class="form-actions">' +
          '<button type="button" class="btn" data-close>Fermer</button>' +
          '<button type="button" class="btn primary" id="info-save">Enregistrer</button>' +
        '</div>' +
        '</form>'
    });

    document.getElementById('info-save').addEventListener('click', () => {
      const c = cfg();
      const mod = c.modules.find((x) => String(x.id) === String(moduleId));
      if (mod) {
        mod.data = App.schema.buildPayload(mod.kind, collectFields(mod.kind, mod.id));
        App.state.updateConfig(c);
      }
      App.modal.close();
      renderRows();
    });
    bindFieldEvents(document.getElementById('info-form'));
  }
  T.editInfoContents = openInfoContents;

  /* =========================================================
     PANNEAU LIGNES
     ========================================================= */
function panelRows() {
    return `
    <section class="panel">
      <div class="panel-head">
        <div class="row-head-left">
          <h2>Lignes de l'exercice <span class="badge" id="row-count">0</span></h2>
          <button type="button" class="btn small rows-flatten-all" id="rows-toggle-flatten"
                  title="Plier ou déplier toutes les lignes"
                  aria-label="Plier ou déplier toutes les lignes">⊟ Tout plier</button>
        </div>
        <div class="tools">
          <div class="inline" role="group" aria-label="Vue des lignes" style="gap:.25rem;margin-right:.6rem">
            <button type="button" class="btn small" data-rows-view="compact" title="Vue synthétique : lignes compactes, comme l'ancienne présentation">Vue synthétique</button>
            <button type="button" class="btn small" data-rows-view="modules" title="Vue en modules : cellules détaillées, une boîte par module">Vue modules</button>
          </div>
          <button type="button" class="btn primary" id="row-add">+ Nouvelle ligne</button>
        </div>
      </div>
      <p class="hint" id="row-empty" hidden>Aucune ligne. Cliquez sur « Nouvelle ligne ».</p>
      <ol class="triplet-list" id="row-list"></ol>
    </section>`;
  }

function onToggleFlattenAll() {
    const rows = App.state.rows();
    if (!rows.length) return;
    const allFlat = rows.every((r) => flattenedRowIds.has(String(r.id)));
    if (allFlat) {
      flattenedRowIds.clear();
    } else {
      flattenedRowIds = new Set(rows.map((r) => String(r.id)));
    }
    renderRows();
  }

  function renderRows() {
    const rows = App.state.rows();
    const mods = allMods().filter((m) => m.role === 'associate');
    $('#row-count').textContent = rows.length;
    const toggleBtn = $('#rows-toggle-flatten');
    if (toggleBtn) {
      const allFlat = rows.length > 0 && rows.every((r) => flattenedRowIds.has(String(r.id)));
      toggleBtn.disabled = rows.length === 0;
      toggleBtn.setAttribute('aria-pressed', allFlat ? 'true' : 'false');
      toggleBtn.classList.toggle('primary', allFlat);
      toggleBtn.title = allFlat ? 'Déplier toutes les lignes' : 'Plier toutes les lignes';
      toggleBtn.textContent = allFlat ? '⇕ Tout déplier' : '⊟ Tout plier';
    }
    $('#row-empty').hidden = rows.length > 0;
    if (selectedRowId && !rows.some((r) => String(r.id) === String(selectedRowId))) {
      selectedRowId = null;
    }
    const list = $('#row-list');
    list.classList.toggle('rows-compact', rowsView === 'compact');
    [...document.querySelectorAll('[data-rows-view]')].forEach((b) => {
      const active = b.dataset.rowsView === rowsView;
      b.classList.toggle('primary', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const renderer = rowsView === 'compact' ? rowCompactHtml : rowModulesHtml;
    list.innerHTML = rows.map(renderer).join('');
  }

  /* Vue des lignes : « modules » (détaillée) ou « synthétique » (compacte,
     inspirée de l'ancienne présentation : vignette + résumé court). */
  function rowModulesHtml(r, i) {
      const mods = allMods().filter((m) => m.role === 'associate');
      const cellsHtml = mods.map((m) => cellPreviewHtml(m, r.cells[m.id])).join('');
      const isSel = String(r.id) === String(selectedRowId);
      const isFlat = flattenedRowIds.has(String(r.id));
      const total = App.state.rows().length;
      return `
        <li class="triplet-item${isSel?' selected':''}${isFlat?' is-flattened':''}" data-row-id="${esc(r.id)}">
          <div class="triplet-body">
            <div class="row-tools">
              <button type="button" class="btn small${isFlat?' primary':''}" data-row-act="flatten"
                      title="${isFlat ? 'Déplier la ligne' : 'Aplatir la ligne'}"
                      aria-label="${isFlat ? 'Déplier cette ligne' : 'Aplatir cette ligne'}"
                      aria-pressed="${isFlat ? 'true' : 'false'}">${isFlat ? '⇕' : '⊟'}</button>
              <button type="button" class="btn small" data-row-act="up" title="Monter"
                      aria-label="Monter cette ligne" ${i===0?'disabled':''}>↑</button>
              <button type="button" class="btn small" data-row-act="down" title="Descendre"
                      aria-label="Descendre cette ligne" ${i===total-1?'disabled':''}>↓</button>
              <button type="button" class="btn small primary" data-row-act="edit" title="Modifier"
                      aria-label="Modifier cette ligne">✎</button>
              <button type="button" class="btn small danger" data-row-act="del" title="Supprimer"
                      aria-label="Supprimer cette ligne">🗑</button>
            </div>
            <div class="row-cells">${cellsHtml || '<em class="muted">vide</em>'}</div>
          </div>
        </li>`;
  }

  /* Ligne compacte (vue synthétique) : une vignette par module, sans boîte
     détaillée — image en vignette, texte en gras, même clic pour éditer.
     SANS les boutons ↑↓ ✎ 🗑 : ils restent dans la vue détaillée. */
  function rowCompactHtml(r, i) {
    const mods = allMods().filter((m) => m.role === 'associate');
    const cellsHtml = mods.map((m) => compactCellHtml(m, r.cells[m.id])).join('');
    const isSel = String(r.id) === String(selectedRowId);
    return `
      <li class="triplet-item${isSel ? ' selected' : ''}" data-row-id="${esc(r.id)}">
        <div class="triplet-body">
          <div class="row-cells compact">${cellsHtml || '<em class="muted">ligne vide</em>'}</div>
        </div>
      </li>`;
  }

  function compactCellHtml(m, v) {
    const type = App.schema.Types[m.kind];
    const valid = Boolean(v != null && type && (!type.validate || type.validate(v)));
    const modAttr = ` data-module-id="${esc(m.id)}" title="${valid ? 'Modifier' : 'Ajouter'} ${esc(m.label || m.id)}"`;
    if (!valid) return `<div class="syn-cell empty"${modAttr}><span class="syn-missing">—</span><span class="syn-name">${esc(m.label || m.id)}</span></div>`;
    if (m.kind === 'image') {
      return `<div class="syn-cell image"${modAttr}>` +
        `<span class="syn-thumb"><img src="${esc(resolveSrc(v && v.src))}" alt="" loading="lazy" decoding="async"></span>` +
        `<span class="syn-name">${esc(m.label || m.id)}</span></div>`;
    }
    let main = '';
    if (m.kind === 'text') main = esc(String(v).trim());
    else if (m.kind === 'richtext') {
      const title = v && v.title ? App.utils.stripHtml(String(v.title)) : '';
      const txt = App.utils.stripHtml((v && v.html) || '');
      main = esc(title || txt.slice(0, 60) || '(texte)');
    } else {
      const cap = (v && (v.caption || v.src)) || '';
      const icon = m.kind === 'audio' ? '🔊' : (m.kind === 'video' ? '🎬' : '🌐');
      main = icon + ' ' + esc(String(cap || '').slice(0, 60));
    }
    return `<div class="syn-cell"${modAttr}><span class="syn-text">${main}</span><span class="syn-name">${esc(m.label || m.id)}</span></div>`;
  }

  /* Vignette d'aperçu d'une cellule (module × ligne) */
  function cellPreviewHtml(m, v) {
    const type = App.schema.Types[m.kind];
    const label = `<div class="cell-label">${esc(m.label || m.id)}</div>`;
    const grow = Math.max(0.5, Number(m.span) || 1);
    const styleAttr = ` style="flex-grow:${grow}"`;
    const valid = Boolean(v != null && type && (!type.validate || type.validate(v)));
    const modAttr = ` data-module-id="${esc(m.id)}" title="${valid ? 'Modifier' : 'Ajouter'} ${esc(m.label || m.id)}"`;
    const copyBtn = valid
      ? `<button type="button" class="cell-copy btn small" data-cell-copy="1" data-module-id="${esc(m.id)}"
           title="Copier ce contenu sur d'autres lignes" aria-label="Copier ce contenu sur d'autres lignes">⧉</button>`
      : '';

    if (!valid) {
      return `<div class="cell-box empty"${styleAttr}${modAttr}>${copyBtn}${label}<div class="cell-content">—</div></div>`;
    }

    let content = '';
    let boxExtraClass = '';

    if (m.kind === 'image') {
      const caption = v && v.caption ? String(v.caption).trim() : '';
      boxExtraClass = caption ? ' has-caption' : ' image-only';
      content =
        `<img class="cell-thumb" src="${esc(resolveSrc(v.src))}" alt="" loading="lazy" decoding="async">` +
        (caption ? `<span class="cell-snippet">${esc(caption)}</span>` : '');
    } else if (m.kind === 'text') {
      const raw = String(v).trim();
      const shortClass = raw.length <= 16 ? ' is-short' : '';
      content = `<span class="cell-text${shortClass}">${esc(v)}</span>`;
    } else if (m.kind === 'richtext') {
      const title = v && v.title ? App.utils.stripHtml(String(v.title)) : '';
      const rawHtml = v && v.html ? String(v.html) : '';
      const txt = App.utils.stripHtml(rawHtml);
      const totalLen = (title + ' ' + txt).trim().length;
      const shortClass = totalLen <= 28 ? ' is-short' : '';
      content =
        (title ? `<span class="cell-text${shortClass}">${esc(title)}</span>` : '') +
        (txt ? `<span class="cell-snippet${shortClass}">${esc(txt.slice(0, 180))}</span>` : '');
    } else if (m.kind === 'audio' || m.kind === 'video') {
      const cap = v && v.caption ? v.caption : (m.kind === 'audio' ? '(son)' : '(vidéo)');
      content =
        `<span class="cell-icon">${m.kind === 'audio' ? '🔊' : '🎬'}</span>` +
        `<span class="cell-snippet">${esc(cap)}</span>`;
    } else if (m.kind === 'url') {
      const cap = (v && v.caption) || (v && v.src) || '';
      content =
        `<span class="cell-icon">🌐</span>` +
        `<span class="cell-snippet">${esc(cap)}</span>`;
    } else {
      const s = type && typeof type.summary === 'function' ? (type.summary(v) || '') : '';
      content = `<span class="cell-snippet">${esc(s)}</span>`;
    }

    return `<div class="cell-box${boxExtraClass}"${styleAttr}${modAttr}>${copyBtn}${label}<div class="cell-content">${content}</div></div>`;
  }

  function startAddRow() {
    editingRowId = null;
    showRowForm(null);
  }

  function startEditRow(id) {
    const r = App.state.rows().find((x) => String(x.id) === String(id));
    if (!r) return;
    editingRowId = id;
    showRowForm(r);
  }

  /* =========================================================
     FORMULAIRE LIGNE — dans une MODAL
     ========================================================= */
  function showRowForm(row) {
    /* Les modules informatifs ne figurent plus dans les lignes :
       leurs contenus s'éditent ligne par ligne (bouton 📝 dans la maquette). */
    const mods = allMods().filter((m) => m.role === 'associate');
    if (!mods.length) {
      alert('Créez d\'abord au moins un module « à associer » (dans la maquette).');
      return;
    }
    const formFields = mods.map((m) => {
      const currentValue = row ? row.cells[m.id] : App.schema.Types[m.kind].createEmpty();
      return renderModuleFieldset(m, currentValue);
    }).join('');

    App.modal.open({
      title: row ? 'Modifier la ligne' : 'Nouvelle ligne',
      html: `
        <form id="row-form" novalidate>
          ${formFields}
          <div class="form-actions">
            <button type="submit" class="btn primary">${row ? 'Enregistrer' : 'Ajouter'}</button>
            <button type="button" class="btn" id="row-cancel">Annuler</button>
          </div>
        </form>`
    });

    const form = document.getElementById('row-form');
    document.getElementById('row-cancel').addEventListener('click', hideRowForm);
    form.addEventListener('submit', onSubmitRow);
    bindFieldEvents(form);
  }

  function hideRowForm() {
    App.modal.close();
    editingRowId = null;
  }

  /* =========================================================
     FORMULAIRE D'UN SEUL BLOC — dans une MODAL
     ========================================================= */
  function showSingleCellForm(rowId, moduleId) {
    const row = App.state.rows().find((x) => String(x.id) === String(rowId));
    const m = allMods().find((x) => String(x.id) === String(moduleId));
    if (!row || !m) return;

    editingCellCtx = { rowId: row.id, moduleId: m.id };
    const type = App.schema.Types[m.kind];
    const currentValue = row.cells[m.id] != null ? row.cells[m.id] : type.createEmpty();
    const rowIndex = App.state.rows().findIndex((x) => String(x.id) === String(row.id)) + 1;

    App.modal.open({
      title: `Ligne ${rowIndex} — ${m.label || m.id}`,
      html: `
        <form id="cell-form" novalidate>
          ${renderModuleFieldset(m, currentValue)}
          <div class="form-actions">
            <button type="submit" class="btn primary">Enregistrer</button>
            <button type="button" class="btn" id="cell-cancel">Annuler</button>
          </div>
        </form>`
    });

    const form = document.getElementById('cell-form');
    document.getElementById('cell-cancel').addEventListener('click', hideSingleCellForm);
    form.addEventListener('submit', onSubmitSingleCell);
    bindFieldEvents(form);
  }

  function hideSingleCellForm() {
    App.modal.close();
    editingCellCtx = null;
  }

  function onSubmitSingleCell(e) {
    e.preventDefault();
    if (!editingCellCtx) return;
    const { rowId, moduleId } = editingCellCtx;
    const m = allMods().find((x) => String(x.id) === String(moduleId));
    if (!m) return;

    const val = collectModuleValue(m.id);
    const type = App.schema.Types[m.kind];
    if (type && typeof type.validate === 'function' && !type.validate(val)) {
      const ok = confirm(
        'Le contenu de « ' + (m.label || type.label) + ' » est vide ou incomplet.\n\n' +
        'Enregistrer quand m\u00eame ? Vous pourrez compléter cet élément plus tard.'
      );
      if (!ok) return;
    }

    App.state.updateRow(rowId, { [m.id]: val });
    selectedRowId = rowId;
    hideSingleCellForm();
  }

  /* Copie du contenu d'une cellule vers d'autres lignes.
     Avec le pool dédupliqué côté élève, ces copies n'affichent qu'un seul
     exemplaire dans la réserve, qui peut être redéposé autant de fois. */
  function openCopyDialog(sourceRowId, moduleId) {
    const m = allMods().find((x) => String(x.id) === String(moduleId));
    const src = App.state.rows().find((x) => String(x.id) === String(sourceRowId));
    if (!m || !src) return;
    const type = App.schema.Types[m.kind];
    const value = src.cells[m.id];
    if (value == null || !type || (type.validate && !type.validate(value))) {
      alert('Cette cellule est vide : rien à copier.');
      return;
    }
    const others = App.state.rows().filter((x) => String(x.id) !== String(sourceRowId));
    if (!others.length) {
      alert("Il n'y a qu'une seule ligne : rien à copier.");
      return;
    }
    const sigOf = (x) => JSON.stringify(x == null ? null : x);
    const ownSig = sigOf(value);
    const labelOf = (r) => {
      const mod = allMods().find((mm) => mm.role === 'associate' &&
        r.cells[mm.id] != null);
      const txt = mod ? App.schema.Types[mod.kind].summary(r.cells[mod.id]) : '';
      return 'Ligne ' + (App.state.rows().indexOf(r) + 1) + (txt ? ' — ' + App.utils.stripHtml(txt).slice(0, 40) : '');
    };

    const listHtml = others.map((r) => {
      const same = sigOf(r.cells[m.id]) === ownSig;
      return `
        <label class="inline" style="gap:.4rem;padding:.15rem 0">
          <input type="checkbox" class="copy-row" data-copy-row="${esc(r.id)}" ${same?'checked':''}>
          ${esc(labelOf(r))}${same ? ' <span class="muted">(contenu identique)</span>' : ''}
        </label>`;
    }).join('');

    App.modal.open({
      title: 'Copier « ' + (m.label || m.id) + ' » vers d\'autres lignes',
      html: `
        <div class="hint" style="margin-bottom:.6rem">Le contenu copié remplace celui des lignes cochées.
          Chez l'élève, ce module n'apparaît qu'une seule fois dans la réserve
          et peut être redéposé sur chaque ligne concernée.</div>
        <div id="copy-rows">${listHtml}</div>
        <div class="form-actions" style="margin-top:1rem">
          <button type="button" class="btn link" id="copy-all">Sélectionner toutes les lignes</button>
          <button type="button" class="btn primary" id="copy-apply">Copier</button>
          <button type="button" class="btn" data-close>Annuler</button>
        </div>`
    });

    document.getElementById('copy-all').addEventListener('click', () => {
      document.querySelectorAll('#copy-rows .copy-row').forEach((cb) => { cb.checked = true; });
    });
    document.getElementById('copy-apply').addEventListener('click', () => {
      const updates = [...document.querySelectorAll('#copy-rows .copy-row:checked')]
        .map((cb) => ({ id: cb.dataset.copyRow, cells: { [m.id]: JSON.parse(JSON.stringify(value)) } }));
      if (!updates.length) { App.modal.close(); return; }
      App.state.updateRowsBulk(updates);
      App.modal.close();
      renderRows();
    });
  }

  function renderModuleFieldset(m, value, idKey) {
    const type = App.schema.Types[m.kind];
    const fields = type.formSchema(value || type.createEmpty());
    const key = idKey || m.id;
    /* Texte enrichi : UN SEUL bouton œil, en bas du formulaire — il montre
       la fenêtre de lecture telle que l'élève la verra (titre + contenu
       mis en forme). Les œils de la barre d'outils ont été retirés. */
    const preview = m.kind === 'richtext'
      ? `<div class="form-actions">
           <button type="button" class="btn" data-richtext-preview="${esc(m.id)}"
                   title="Montrer la fenêtre de lecture vue par l'élève">👁 Aperçu élève</button>
         </div>` : '';
    return `
      <fieldset class="module-fieldset" data-module="${esc(m.id)}">
        <legend>${esc(m.label || m.id)} <span class="badge">${esc(type.label)}</span></legend>
        ${fields.map((f) => renderField(key, f)).join('')}
        ${preview}
      </fieldset>`;
  }

  function renderField(moduleId, field) {
    const id = 'f_' + moduleId + '_' + field.name;
    const label = esc(field.label || field.name);
    const value = field.value == null ? '' : String(field.value);

    if (field.type === 'text') {
      return fieldHtml(id, label, `<input id="${id}" data-field="${esc(field.name)}" type="text" value="${esc(value)}"${field.required?' required':''}>`);
    }
    if (field.type === 'url') {
      return fieldHtml(id, label, `<input id="${id}" data-field="${esc(field.name)}" type="url" value="${esc(value)}" placeholder="https://…">`);
    }
    if (field.type === 'color') {
      /* Variante réinitialisable (allowEmpty) : la couleur « par défaut »
         est représentée par une valeur vide — une pastille noire du sélecteur
         natif ne veut alors pas dire couleur noire appliquée. */
      if (field.allowEmpty) {
        return fieldHtml(id, label, `<div class="inline">
          <input id="${id}_picker" type="color" value="${esc(value||'#ffffff')}"
                 data-color-for="${esc(field.name)}">
          <button type="button" class="btn link" data-clear-color="${esc(field.name)}"
                  title="Revenir à la couleur par défaut">Par défaut</button>
          ${field.hint ? `<span class="hint">${esc(field.hint)}</span>` : ''}
          <input id="${id}" data-field="${esc(field.name)}" type="hidden" value="${esc(value||'')}">
        </div>`);
      }
      return fieldHtml(id, label, `<input id="${id}" data-field="${esc(field.name)}" type="color" value="${esc(value || (field.allowEmpty ? '#ffffff' : '#000000'))}">`);
    }
    if (field.type === 'select') {
      const opts = (field.options||[]).map((o) => {
        const val = typeof o === 'string' ? o : o.value;
        const lab = typeof o === 'string' ? o : o.label;
        return `<option value="${esc(val)}" ${value===val?'selected':''}>${esc(lab)}</option>`;
      }).join('');
      return fieldHtml(id, label, `<select id="${id}" data-field="${esc(field.name)}">${opts}</select>`);
    }
    if (field.type === 'url-or-file') {
      const showPreview = (field.accept||'').indexOf('image') !== -1;
      const isUrl = /^https?:\/\//i.test(value);
      const shown = resolveSrc(value);
      return `
        <div class="field">
          <label>${label}</label>
          <div class="inline">
            <input id="${id}_url" type="url" placeholder="URL (https://…)" value="${isUrl?esc(value):''}">
            <span class="or">ou</span>
            <input id="${id}_file" type="file" accept="${esc(field.accept||'')}">
          </div>
          ${showPreview ? `
            <div class="image-preview" id="${id}_preview" ${value?'':'hidden'}>
              <img alt="" src="${esc(shown)}">
              <button type="button" class="btn link" data-clear="${id}">Retirer</button>
            </div>` : ''}
          <input id="${id}" data-field="${esc(field.name)}" type="hidden" value="${esc(value)}">
        </div>`;
    }
   if (field.type === 'richtext') {
      return `
        <div class="field">
          <label>${label}</label>
          <div class="rte" data-rte-module="${esc(moduleId)}" data-rte-field="${esc(field.name)}">
            ${rteToolbarHtml()}
            <div class="rte-editor" contenteditable="true" data-placeholder="${esc(field.label||'')}">${rteEditorHtml(value)}</div>
          </div>
        </div>`;
    }
    return `<p class="hint">Type de champ inconnu : ${esc(field.type)}</p>`;
  }

  /* Sélecteur de fichier + insertion dans l'éditeur riche.
     Le fichier est rangé dans le magasin de médias (IndexedDB) comme pour
     les images de modules ; l'éditeur l'affiche immédiatement. */
  function pickAndInsertImage(editor) {
    if (!editor) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const done = (ref) => {
        editor.focus();
        document.execCommand('insertHTML', false,
          '<p><img src="' + esc(ref) + '" alt=""></p>');
      };
      if (App.media && typeof App.media.putFile === 'function') {
        App.media.putFile(file).then(done).catch(() => fallbackImageInsert(file, done));
        return;
      }
      fallbackImageInsert(file, done);
    });
    input.click();
  }

  function fallbackImageInsert(file, done) {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result));
    reader.readAsDataURL(file);
  }

  /* Affichage de l'éditeur : les références « media: » sont montrées via
     leur URL affichable ; l'enregistrement les reconvertit (voir collect). */
  function rteEditorHtml(value) {
    if (App.utils && typeof App.utils.resolveMediaInHtml === 'function') {
      return App.utils.resolveMediaInHtml(value);
    }
    return value;
  }

  /* Barre d'outils commune à tous les éditeurs riches. */
  function rteToolbarHtml() {
    return `
            <div class="rte-toolbar">
              <button type="button" class="rte-btn" data-cmd="bold" title="Gras"><b>G</b></button>
              <button type="button" class="rte-btn" data-cmd="italic" title="Italique"><i>I</i></button>
              <button type="button" class="rte-btn" data-cmd="underline" title="Souligné"><u>S</u></button>
              <span class="rte-sep"></span>
              <button type="button" class="rte-btn" data-cmd="justifyLeft" title="Aligner à gauche" aria-label="Aligner à gauche">◧</button>
              <button type="button" class="rte-btn" data-cmd="justifyCenter" title="Centrer" aria-label="Centrer">▣</button>
              <button type="button" class="rte-btn" data-cmd="justifyRight" title="Aligner à droite" aria-label="Aligner à droite">◨</button>
              <span class="rte-sep"></span>
              <select class="rte-select rte-font" title="Police d'écriture" aria-label="Police d'écriture">
                <option value="">Police par défaut</option>
                <option value="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">Sans-serif (système)</option>
                <option value="Georgia, 'Times New Roman', serif">Serif (Georgia)</option>
                <option value="'Trebuchet MS', sans-serif">Trebuchet</option>
                <option value="Verdana, sans-serif">Verdana</option>
                <option value="'Courier New', monospace">Monospace</option>
              </select>
              <select class="rte-select rte-size" title="Taille du texte" aria-label="Taille du texte">
                <option value="">Taille</option>
                <option value="0.85rem">Petit</option>
                <option value="1rem">Normal</option>
                <option value="1.2rem">Grand</option>
                <option value="1.45rem">Très grand</option>
              </select>
              <select class="rte-select rte-lineheight" title="Interlignage" aria-label="Interlignage">
                <option value="">Interligne</option>
                <option value="1.2">Serré (1,2)</option>
                <option value="1.5">Standard (1,5)</option>
                <option value="1.85">Aéré (1,85)</option>
                <option value="2.2">Large (2,2)</option>
              </select>
              <span class="rte-sep"></span>
              <label class="rte-color"><input type="color" class="rte-color-input" data-color="fore" value="#dc2626"><span>Couleur</span></label>
              <button type="button" class="rte-btn" data-apply-color="fore" title="Appliquer la couleur choisie" aria-label="Appliquer la couleur choisie">✓</button>
              <label class="rte-color"><input type="color" class="rte-color-input" data-color="back" value="#fef3c7"><span>Surligner</span></label>
              <button type="button" class="rte-btn" data-apply-color="back" title="Appliquer la couleur de surlignage choisie" aria-label="Appliquer le surlignage choisi">✓</button>
              <button type="button" class="rte-btn" data-clear-hilite="1" title="Enlever totalement le surlignage" aria-label="Enlever totalement le surlignage">⬜</button>
              <span class="rte-sep"></span>
              <button type="button" class="rte-btn" data-action="rte-image" title="Insérer une image">🖼</button>
              <button type="button" class="rte-btn" data-cmd="clear" title="Effacer la mise en forme">✕</button>
            </div>`;
  }

  function fieldHtml(id, label, inputHtml) {
    return `<div class="field"><label for="${id}">${label}</label>${inputHtml}</div>`;
  }

  function bindFieldEvents(formEl) {
    /* Fiabilité des outils : le clic sur un bouton de la barre ne fait PAS
       sortir le focus de l'éditeur (sinon la sélection était perdue et la
       mise en forme s'appliquait au mauvais passage — comportement
       erratique signalé par le prof). */
    formEl.addEventListener('mousedown', (e) => {
      const btn = e.target.closest('.rte-btn');
      if (btn) { e.preventDefault(); return; }
      /* Menus déroulants et sélecteurs de couleur : on ne peut pas empêcher
         le changement de focus (il faut pouvoir choisir dans la liste), alors
         on mémorise la sélection AVANT qu'elle ne soit perdue. */
      const ctl = e.target.closest('.rte-select, .rte-color-input');
      if (ctl) {
        const rteEl = ctl.closest('.rte');
        const editor = rteEl && rteEl.querySelector('.rte-editor');
        if (editor) rteRemember(editor);
      }
    });
    formEl.addEventListener('click', (e) => {
      const imgBtn = e.target.closest('[data-action="rte-image"]');
      if (imgBtn) {
        e.preventDefault();
        e.stopPropagation();
        const rteEl = imgBtn.closest('.rte');
        if (rteEl) pickAndInsertImage(rteEl.querySelector('.rte-editor'));
        return;
      }
      /* 👁 Aperçu élève (un seul par module enrichi, en bas du formulaire) :
         montre la fenêtre de lecture TELLE QUE L'ÉLÈVE la verra en cliquant
         sur le module — titre et contenu mis en forme, bandeau coloré. */
      const prevBtn = e.target.closest('[data-richtext-preview]');
      if (prevBtn) {
        e.preventDefault();
        const fs = prevBtn.closest('.module-fieldset');
        const m = fs && allMods().find((x) => String(x.id) === String(fs.dataset.module));
        if (m && m.kind === 'richtext') {
          const v = App.schema.buildPayload(m.kind, collectFields(m.kind, m.id));
          openReadingPreview(m, v);
        }
        return;
      }
      /* ✓ Appliquer : AVANT la branche générique .rte-btn (le bouton porte
         aussi cette classe) — applique la couleur choisie au carré voisin. */
      const applyColorBtn = e.target.closest('[data-apply-color]');
      if (applyColorBtn) {
        e.preventDefault();
        const rteEl = applyColorBtn.closest('.rte');
        const colorInput = rteEl && rteEl.querySelector('.rte-color-input[data-color="' + applyColorBtn.dataset.applyColor + '"]');
        if (rteEl && colorInput) {
          const editor = rteEl.querySelector('.rte-editor');
          rteExec(editor, colorInput.dataset.color === 'fore' ? 'foreColor' : 'hiliteColor', colorInput.value);
        }
        return;
      }
      /* Enlever totalement le surlignage (et pas seulement le changer). */
      const clearHilite = e.target.closest('[data-clear-hilite]');
      if (clearHilite) {
        e.preventDefault();
        const editor = clearHilite.closest('.rte').querySelector('.rte-editor');
        rteExec(editor, 'hiliteColor', 'transparent');
        return;
      }
      const btn = e.target.closest('.rte-btn');
      if (btn) {
        e.preventDefault();
        const editor = btn.closest('.rte').querySelector('.rte-editor');
        const cmd = btn.dataset.cmd;
        rteExec(editor, cmd === 'clear' ? 'removeFormat' : cmd, null);
        return;
      }
      const clearColorBtn = e.target.closest('[data-clear-color]');
      if (clearColorBtn) {
        e.preventDefault();
        const wrap = clearColorBtn.closest('.field');
        const hidden = wrap && wrap.querySelector('input[type=hidden][data-field="' + clearColorBtn.dataset.clearColor + '"]');
        const picker = wrap && wrap.querySelector('input[type=color][data-color-for="' + clearColorBtn.dataset.clearColor + '"]');
        if (hidden) hidden.value = '';
        if (picker) picker.value = '#ffffff';   // blanc = défaut (étiquette sans bandeau coloré)
        return;
      }
      const clearBtn = e.target.closest('[data-clear]');
      if (clearBtn) {
        e.preventDefault();
        const id = clearBtn.dataset.clear;
        document.getElementById(id).value = '';
        document.getElementById(id + '_url').value = '';
        document.getElementById(id + '_file').value = '';
        const preview = document.getElementById(id + '_preview');
        if (preview) { preview.querySelector('img').removeAttribute('src'); preview.hidden = true; }
      }
    });
    formEl.addEventListener('input', (e) => {
      const titleColor = e.target.closest('input[type=color][data-color-for]');
      if (titleColor) {
        const wrap = titleColor.closest('.field');
        const hidden = wrap && wrap.querySelector('input[type=hidden][data-field="' + titleColor.dataset.colorFor + '"]');
        if (hidden) hidden.value = titleColor.value;
        return;
      }
      /* Couleurs du texte : l'application « en direct » pendant le choix
         (event input) fragmentait la sélection. La couleur est appliquée
         à la validation du sélecteur natif (event change, ci-dessous) ou
         via le bouton ✓ à côté du carré de couleur. */
      if (e.target.id && e.target.id.endsWith('_url')) {
        const baseId = e.target.id.slice(0, -4);
        document.getElementById(baseId).value = e.target.value;
        const preview = document.getElementById(baseId + '_preview');
        if (preview) {
          const src = e.target.value;
          if (src) { preview.querySelector('img').src = src; preview.hidden = false; }
          else { preview.querySelector('img').removeAttribute('src'); preview.hidden = true; }
        }
      }
    });
    formEl.addEventListener('change', (e) => {
      if (e.target.classList && e.target.classList.contains('rte-color-input')) {
        const editor = e.target.closest('.rte').querySelector('.rte-editor');
        rteExec(editor, e.target.dataset.color === 'fore' ? 'foreColor' : 'hiliteColor', e.target.value);
        return;
      }
      if (e.target.id && e.target.id.endsWith('_file')) {
        const baseId = e.target.id.slice(0, -5);
        onFileField(e.target, baseId);
      }
      if (e.target.classList.contains('rte-font')) {
        const editor = e.target.closest('.rte').querySelector('.rte-editor');
        applyRteSpanStyle(editor, 'fontFamily', e.target.value);
        e.target.value = '';
        return;
      }
      if (e.target.classList.contains('rte-size')) {
        const editor = e.target.closest('.rte').querySelector('.rte-editor');
        applyRteSpanStyle(editor, 'fontSize', e.target.value);
        e.target.value = '';
        return;
      }
      if (e.target.classList.contains('rte-lineheight')) {
        const editor = e.target.closest('.rte').querySelector('.rte-editor');
        applyRteLineHeight(editor, e.target.value);
        e.target.value = '';
        return;
      }
    });
  }
  
  /* =========================================================
     SÉLECTION DANS LES ÉDITEURS RICHES
     Cliquer un bouton ou un menu de la barre d'outils fait sortir
     le focus de l'éditeur et peut effacer la sélection : on mémorise
     en continu la dernière sélection vue dans chaque éditeur et on la
     restitue juste avant d'appliquer un effet.
     ========================================================= */
  const rteRanges = new WeakMap();
  document.addEventListener('selectionchange', () => {
    if (Date.now() < rteSelLock) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.anchorNode) return;
    const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    if (!node) return;
    const host = node.closest('.rte-editor');
    if (host && host.isContentEditable) rteRanges.set(host, sel.getRangeAt(0).cloneRange());
  });

  /* Verrou court : le focus() déclenche un selectionchange qui ramène le
     curseur au début de l'éditeur — on l'ignore pendant la restauration. */
  let rteSelLock = 0;
  function rteRestoreSelection(editor) {
    const r = rteRanges.get(editor);
    rteSelLock = Date.now() + 200;
    editor.focus();
    if (r) {
      try {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (err) { return false; }
    }
    return !!r;
  }

  /* Sélection « utile » dans l'éditeur : sélection live, ou plage
     sauvegardée (le clic sur un bouton/sélecteur la fait perdre), à
     condition qu'elle ne soit pas réduite et qu'elle appartienne bien à
     cet éditeur. Sinon → null. */
  function rteActiveRange(editor) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (!r.collapsed && editor.contains(r.commonAncestorContainer)) return r.cloneRange();
    }
    const saved = rteRanges.get(editor);
    if (saved && !saved.collapsed && editor.contains(saved.commonAncestorContainer)) {
      return saved.cloneRange();
    }
    return null;
  }

  /* Prépare l'outil : focus + sélection utile. SI AUCUN TEXTE N'EST
     SÉLECTIONNÉ, la plage devient TOUT le contenu de l'éditeur : le
     réglage (gras, taille, couleur…) s'applique alors à l'ensemble du
     texte, sans avoir à sélectionner (demande prof). */
  function rteReadyRange(editor) {
    rteSelLock = Date.now() + 200;
    editor.focus();
    let r = rteActiveRange(editor);
    if (!r) {
      r = document.createRange();
      r.selectNodeContents(editor);
    }
    const sel = window.getSelection();
    try {
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (err) { /* jsdom, etc. */ }
    if (!sel || !sel.rangeCount) {
      /* Dernier recours : sélectionner tout le contenu plutôt que de laisser
         la commande s'appliquer à une sélection vide (réglage sans effet). */
      try { sel.selectAllChildren(editor); } catch (err2) { /* jsdom, etc. */ }
    }
    return r;
  }

  /* Mémorise la sélection live d'un éditeur (l'event selectionchange est
     ignoré pendant le verrou, donc on le fait explicitement). */
  function rteRemember(editor) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (editor.contains(r.commonAncestorContainer)) rteRanges.set(editor, r.cloneRange());
    }
  }

  /* Exécute une commande sur l'éditeur : sélection utile (ou tout le
     texte), commande, puis mémorisation de la sélection résultat. */
  function rteExec(editor, cmd, val) {
    rteReadyRange(editor);
    /* Écriture des couleurs en style inline (span style=…) et non en
       balises <font> : c'est ce qui permet à la couleur de texte choisie
       de survivre à l'assainissement à l'enregistrement. */
    try { document.execCommand('styleWithCSS', false, true); } catch (err) { /* ancien moteur */ }
    document.execCommand(cmd, false, val == null ? null : val);
    rteRemember(editor);
  }

  function applyRteSpanStyle(editor, cssProp, cssVal) {
    if (!cssVal) return;
    /* Sélection utile, ou TOUT le texte si rien n'est sélectionné :
       choisir une taille/police sans sélection met en forme l'ensemble. */
    const range = rteReadyRange(editor);
    if (!range) return;
    const sel = window.getSelection();

    const span = document.createElement('span');
    span.style[cssProp] = cssVal;
    try {
      range.surroundContents(span);
    } catch (_) {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
    /* La sélection reste sur le texte recouvert (elle n'est plus réduite
       au curseur) : les outils suivants s'appliquent au même passage. */
    sel.removeAllRanges();
    const after = document.createRange();
    after.selectNodeContents(span);
    sel.addRange(after);
    rteRemember(editor);
  }

function applyRteLineHeight(editor, lineHeightVal) {
    if (!lineHeightVal) {
      editor.style.lineHeight = '';
      editor.querySelectorAll('p, div, li, blockquote').forEach((node) => {
        node.style.lineHeight = '';
      });
      return;
    }

    /* Sélection utile, ou tout le texte si rien n'est sélectionné. */
    const range = rteReadyRange(editor);
    let appliedToBlock = false;
    if (range && editor.contains(range.commonAncestorContainer)) {
      const blocks = [...editor.querySelectorAll('p, div, li, blockquote')].filter((b) =>
        range.intersectsNode(b)
      );
      if (blocks.length) {
        blocks.forEach((b) => { b.style.lineHeight = lineHeightVal; });
        appliedToBlock = true;
      }
    }
    rteRemember(editor);

    if (!appliedToBlock) {
      let wrapper = editor.querySelector(':scope > p, :scope > div');
      if (!wrapper) {
        wrapper = document.createElement('p');
        while (editor.firstChild) {
          wrapper.appendChild(editor.firstChild);
        }
        editor.appendChild(wrapper);
      }
      wrapper.style.lineHeight = lineHeightVal;
    }
  }

  /* 👁 Aperçu élève : la fenêtre de lecture (celle que l'élève ouvre en
     cliquant sur le module) avec les valeurs ACTUELLES du formulaire —
     titre et contenu mis en forme, bandeau coloré. Affichée en calque
     par-dessus le formulaire d'édition : fermer l'aperçu ne perd aucune
     modification en cours. */
  function openReadingPreview(m, value) {
    const T = App.schema.Types.richtext;
    const titleHtml = T.modalTitleHtml(value);
    const titleText = (value && value.title && App.utils.stripHtml(String(value.title))) ||
      (m.label || 'Texte enrichi');
    const body = '<div class="modal-rich">' +
      ((value && value.html) ? App.utils.resolveMediaInHtml(value.html) : '<p class="muted">(Contenu vide)</p>') +
      '</div>';
    const tc = (value && typeof value.titleColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.titleColor))
      ? ' style="background:' + esc(value.titleColor) + ';color:' + App.utils.contrastText(value.titleColor) +
        ';border-bottom-color:' + esc(value.titleColor) + '"' : '';

    /* Calque indépendant du modal-root : le formulaire d'édition reste
       intact dessous (App.modal ne gère qu'une fenêtre à la fois). */
    let layer = document.getElementById('reading-preview-root');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'reading-preview-root';
      document.body.appendChild(layer);
    }
    layer.innerHTML =
      '<div class="modal-backdrop reading-preview-backdrop">' +
        '<div class="modal" role="dialog" aria-modal="true">' +
          '<div class="modal-head"' + tc + '>' +
            '<h3>' + (titleHtml || App.utils.escapeHtml(titleText)) + '</h3>' +
            '<button type="button" class="modal-close" data-preview-close aria-label="Fermer l\'aperçu">✕</button>' +
          '</div>' +
          '<div class="modal-body">' + body + '</div>' +
        '</div>' +
      '</div>';

    const closeLayer = () => { if (layer) layer.innerHTML = ''; };
    layer.querySelector('.reading-preview-backdrop').addEventListener('click', (e) => {
      if (e.target.classList.contains('reading-preview-backdrop') || e.target.hasAttribute('data-preview-close')) {
        e.stopPropagation();
        closeLayer();
      }
    });
    /* Échap ferme l'APERÇU seulement (pas le formulaire dessous) : la
       capture bloque la propagation vers le gestionnaire d'App.modal. */
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeLayer(); document.removeEventListener('keydown', onKey, true); }
    };
    document.addEventListener('keydown', onKey, true);
  }

  function onFileField(input, baseId) {
    const file = input.files[0];
    if (!file) return;
    const apply = (value) => {
      document.getElementById(baseId).value = value;
      document.getElementById(baseId + '_url').value = '';
      const preview = document.getElementById(baseId + '_preview');
      if (preview) { preview.querySelector('img').src = resolveSrc(value); preview.hidden = false; }
    };
    if (App.media && typeof App.media.putFile === 'function') {
      App.media.putFile(file).then(apply).catch(() => fallbackFileField(file, apply, input));
      return;
    }
    fallbackFileField(file, apply, input);
  }

  function fallbackFileField(file, apply, input) {
    if (file.size > 800 * 1024) {
      const ko = Math.round(file.size / 1024);
      if (!confirm('Fichier volumineux (' + ko + ' Ko).\nLe stockage local risque de saturer.\nPréférez une URL. Continuer ?')) {
        if (input) input.value = '';
        return;
      }
    }
    const reader = new FileReader();
    reader.onload = () => apply(String(reader.result));
    reader.readAsDataURL(file);
  }

  /* Lit les champs d'un type de contenu dans la page en cours ; keyBase
     distingue les occurrences (une cellule par module, ou par ligne pour
     les contenus d'information). */
  function collectFields(kind, keyBase) {
    const type = App.schema.Types[kind];
    const fields = type.formSchema(type.createEmpty());
    const collected = {};
    fields.forEach((f) => {
      const id = 'f_' + keyBase + '_' + f.name;
      if (f.type === 'richtext') {
        const editor = document.querySelector(
          '[data-rte-module="' + keyBase + '"][data-rte-field="' + f.name + '"] .rte-editor');
        const raw = editor ? editor.innerHTML : '';
        const withRefs = App.utils.htmlWithMediaRefs
          ? App.utils.htmlWithMediaRefs(raw) : raw;
        collected[f.name] = App.utils.sanitizeRich(withRefs);
      } else {
        const el = document.getElementById(id);
        collected[f.name] = el ? el.value : '';
      }
    });
    return collected;
  }

  function collectModuleValue(moduleId) {
    const m = allMods().find((x) => x.id === moduleId);
    if (!m) return null;
    return App.schema.buildPayload(m.kind, collectFields(m.kind, m.id));
  }

  function onSubmitRow(e) {
    e.preventDefault();
    const mods = allMods().filter((m) => m.role === 'associate');
    const cells = {};
    for (const m of mods) {
      cells[m.id] = collectModuleValue(m.id);
    }
    const fakeRow = { id: editingRowId || 'tmp', cells };
    const errors = App.schema.validateRow(fakeRow, cfg());
    if (errors.length) {
      /* Une ligne incomplète est admissible : le prof complète plus tard.
         La confirm ne demande son accord que si des éléments sont vides. */
      const ok = confirm(
        'Cette ligne est incompl\u00e8te (\u00e9l\u00e9ments laiss\u00e9s \u00e0 remplir) :\n\n' +
        errors.map((x) => '• ' + x.message).join('\n') +
        '\n\nEnregistrer quand m\u00eame ? Vous pourrez compléter ces éléments plus tard.'
      );
      if (!ok) return;
    }
    if (editingRowId) {
      App.state.updateRow(editingRowId, cells);
      selectedRowId = editingRowId;
    } else {
      const newId = App.utils.uid('r');
      App.state.addRow({ id: newId, cells });
      selectedRowId = newId;
    }
    hideRowForm();
  }

  function onRowListClick(e) {
    const copyBtn = e.target.closest('.cell-copy[data-module-id]');
    if (copyBtn) {
      e.stopPropagation();
      const li = copyBtn.closest('li[data-row-id]');
      if (li) openCopyDialog(li.dataset.rowId, copyBtn.dataset.moduleId);
      return;
    }

    const btn = e.target.closest('button[data-row-act]');
    if (btn && !btn.disabled) {
      const li = btn.closest('li[data-row-id]');
      if (li) {
        const id = li.dataset.rowId;
        const act = btn.dataset.rowAct;
        if (act === 'flatten') {
          const key = String(id);
          if (flattenedRowIds.has(key)) flattenedRowIds.delete(key);
          else flattenedRowIds.add(key);
          renderRows();
        } else if (act === 'up') App.state.moveRow(id, -1);
        else if (act === 'down') App.state.moveRow(id, 1);
        else if (act === 'edit') startEditRow(id);
        else if (act === 'del') {
          if (confirm('Supprimer cette ligne ?')) App.state.removeRow(id);
        }
      }
      return;
    }

    const cellBox = e.target.closest('.cell-box[data-module-id], .syn-cell[data-module-id]');
    if (cellBox) {
      const li = cellBox.closest('li[data-row-id]');
      if (li) {
        selectedRowId = li.dataset.rowId;
        showSingleCellForm(li.dataset.rowId, cellBox.dataset.moduleId);
      }
      return;
    }

    const li = e.target.closest('li[data-row-id]');
    if (!li) return;
    const id = li.dataset.rowId;
    /* Différer la sélection : si le rendu était immédiat, le premier clic
       reconstruisait la liste et l'élément disparaissait avant le second
       clic — le double-clic n'arrivait jamais (constat prof : double-clic
       sans effet sur les lignes compactes). */
    clearTimeout(rowClickTimer);
    rowClickTimer = setTimeout(() => {
      selectedRowId = (String(selectedRowId) === String(id)) ? null : id;
      renderRows();
    }, 260);
  }

  /* Minuteur du clic simple sur une ligne (annulé par le double-clic). */
  let rowClickTimer = 0;

  function onRowListDblClick(e) {
    clearTimeout(rowClickTimer);
    if (e.target.closest('button[data-row-act]')) return;
    if (e.target.closest('.cell-box[data-module-id], .syn-cell[data-module-id]')) return;
    const li = e.target.closest('li[data-row-id]');
    if (!li) return;
    startEditRow(li.dataset.rowId);
  }

  /* =========================================================
     PANNEAU DONNÉES
     ========================================================= */
  function panelData() {
    return `
    <section class="panel">
      <h2>Données</h2>
      <div class="tools">
        <button type="button" class="btn primary" id="data-portable">📦 Exporter pour la classe (data.js)</button>
        <button type="button" class="btn" id="data-export">Sauvegarder (JSON)</button>
        <button type="button" class="btn" id="data-import-btn">Importer (JSON)</button>
        <input type="file" id="data-import" accept="application/json,.json" hidden>
        <button type="button" class="btn" id="data-results-btn">📂 Résultats élèves</button>
        <input type="file" id="data-results-input" accept="application/json,.json" multiple hidden>
        <button type="button" class="btn danger" id="data-clear-all">Tout effacer</button>
      </div>
    </section>`;
  }

  /* Jeu de données autonome pour l'export : les références « media: »
     sont réintégrées en « data: » (fichiers réincrustés). */
  function exportData() {
    if (App.media && typeof App.media.inline === 'function') return App.media.inline(App.state.data);
    return Promise.resolve(App.state.data);
  }

  async function onExportPortable() {
    const data = await exportData();
    const content =
      '/* Données de l\'exercice — générées le ' + new Date().toLocaleString('fr-FR') + ' */\n' +
      'window.ASSOC3_SEED = ' + JSON.stringify(data, null, 2) + ';\n';
    App.utils.download('data.js', content, 'application/javascript');
    alert('Fichier "data.js" généré. Placez-le à côté de index.html.');
  }

  async function onExport() {
    const data = await exportData();
    App.utils.download('associations.json', JSON.stringify(data, null, 2), 'application/json');
  }

  async function onImport(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const isV2 = data && data.config && Array.isArray(data.rows);
      const isV1 = data && Array.isArray(data.triplets);
      if (!isV2 && !isV1) { alert('Format non reconnu.'); return; }
      const ask = isV2 ? 'Remplacer TOUTES les données actuelles ?'
                       : 'Format ancien détecté. Remplacer toutes les données par cet import ?';
      if (!confirm(ask)) return;
      App.state.replaceAll(data);
      alert('✓ ' + (isV2 ? data.rows : data.triplets).length + ' ligne(s) importée(s)' + (isV1 ? ' (migration).' : '.'));
    } catch (err) {
      alert('Erreur : ' + err.message);
    }
  }

  function onClearAll() {
    if (!confirm('Supprimer TOUTES les données ? Action irréversible.')) return;
    const cfg = App.state.config();
    if (App.media && typeof App.media.clear === 'function') {
      App.media.clear();
    }
    App.state.replaceAll({ version: 2, config: cfg, rows: [] });
  }

  async function onResultsLoad(e) {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const parsed = await Promise.all(files.map(async (file) => {
      try {
        const data = JSON.parse(await file.text());
        return (data && data.type === 'assoc3-result' && Array.isArray(data.answers)) ? data : null;
      } catch (err) {
        console.warn('Fichier ignoré :', file.name);
        return null;
      }
    }));
    showResultsModal(parsed.filter(Boolean));
  }

  function showResultsModal(results) {
    if (!results.length) { alert('Aucun résultat valide.'); return; }
    const rows = App.state.rows();
    const byId = {};
    rows.forEach((r) => { byId[String(r.id)] = r; });
    const mods = assocMods();

    const html = results.map((r) => {
      const date = esc((r.student && (r.student.name || r.student.date)) || '—');
      const score = (r.score && r.score.total != null) ? r.score.total : '—';
      const max = (r.score && r.score.max != null) ? r.score.max : '—';
      const detail = r.answers.map((a) => {
        const ok = a.correct === true;
        const cells = a.cells || {};
        const cellRows = mods.map((m) => {
          const rowId = cells[m.id];
          if (rowId == null) return '<td><span class="mini-missing">—</span></td>';
          const row = byId[String(rowId)];
          if (!row) return '<td><span class="mini-missing">?</span></td>';
          const v = row.cells[m.id];
          const s = v == null ? '' : (App.schema.Types[m.kind].summary(v) || '');
          return '<td>' + esc(String(s).slice(0, 60)) + '</td>';
        }).join('');
        return '<tr class="' + (ok ? 'row-ok' : 'row-ko') + '">' +
          '<td>' + (ok ? '✓' : '✗') + '</td>' + cellRows + '</tr>';
      }).join('');
      return '<div class="result-card">' +
        '<div class="result-head"><strong>' + date + '</strong>' +
        '<span class="result-score">Score : ' + score + ' / ' + max + '</span></div>' +
        '<table class="result-table"><thead><tr><th></th>' +
        mods.map((m) => '<th>' + esc(m.label || m.id) + '</th>').join('') +
        '</tr></thead><tbody>' + detail + '</tbody></table></div>';
    }).join('');

    App.modal.open({
      title: 'Résultats élèves (' + results.length + ')',
      html: '<div class="results-list">' + html + '</div>'
    });
  }

  /* =========================================================
     ÉVÉNEMENTS GLOBAUX
     ========================================================= */
  function bind() {
    $('#cfg-save').addEventListener('click', saveConfig);
    $('#row-add').addEventListener('click', startAddRow);
    $('#rows-toggle-flatten').addEventListener('click', onToggleFlattenAll);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rows-view]');
      if (!b || rowsView === b.dataset.rowsView) return;
      rowsView = b.dataset.rowsView;
      try { localStorage.setItem('assoc3-rows-view', rowsView); } catch (err) {}
      selectedRowId = null;
      renderRows();
    });
    $('#row-list').addEventListener('click', onRowListClick);
    $('#row-list').addEventListener('dblclick', onRowListDblClick);

    document.getElementById('data-portable').addEventListener('click', onExportPortable);
    document.getElementById('data-export').addEventListener('click', onExport);
    document.getElementById('data-import-btn').addEventListener('click', () => document.getElementById('data-import').click());
    document.getElementById('data-import').addEventListener('change', onImport);
    document.getElementById('data-results-btn').addEventListener('click', () => document.getElementById('data-results-input').click());
    document.getElementById('data-results-input').addEventListener('change', onResultsLoad);
    document.getElementById('data-clear-all').addEventListener('click', onClearAll);
  }

  function renderAll() {
    try { syncConfigForm(); } catch (e) { console.error('[teacher.syncConfigForm]', e); }
    try { renderRows(); } catch (e) { console.error('[teacher.renderRows]', e); }
  }
})();