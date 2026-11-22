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
    const font = App.theme.FONTS[t.font] ? t.font : 'system';
    const sizeVal = App.theme.resolve(t)[sizeKey];
    const fontOpts = Object.keys(App.theme.FONTS).map((k) =>
      '<option value="' + k + '"' + (k === font ? ' selected' : '') + '>' +
      esc(App.theme.FONTS[k].label) + '</option>').join('');
    const sizeOpts = Object.keys(sizes).map((k) =>
      '<option value="' + k + '"' + (k === sizeVal ? ' selected' : '') + '>' +
      esc(sizes[k].label) + '</option>').join('');
    App.modal.open({
      title: isTitle ? 'Modifier le titre' : 'Modifier la consigne',
      html:
        '<form id="tx-form" novalidate>' +
          '<div class="field"><label for="tx-content">' +
            (isTitle ? 'Titre' : 'Consigne (ce que verra l’élève)') + '</label>' +
            (isTitle
              ? '<input id="tx-content" type="text" value="' + esc(value) + '">'
              : '<textarea id="tx-content" rows="2">' + esc(value) + '</textarea>') + '</div>' +
          '<div class="inline">' +
            '<div class="field"><label for="tx-size">Taille</label>' +
              '<select id="tx-size">' + sizeOpts + '</select></div>' +
            (isTitle
              ? '<div class="field field-auto"><label for="tx-color">Couleur</label><span class="inline">' +
                '<input id="tx-color" type="color" value="' +
                esc(t.titleColor || t.ink || '#1f2937') + '">' +
                '<button type="button" class="btn link" id="tx-color-auto">Auto</button></span></div>'
              : '') +
            '<div class="field"><label for="tx-font">Police de l’exercice</label>' +
              '<select id="tx-font">' + fontOpts + '</select></div>' +
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
      const content = String(document.getElementById('tx-content').value).trim();
      c2.theme = Object.assign({}, c2.theme, {
        font: document.getElementById('tx-font').value
      });
      c2.theme[sizeKey] = document.getElementById('tx-size').value;
      if (isTitle) {
        c2.title = content;
        c2.theme.titleColor = autoColor ? '' : (colorInput.value || '');
      } else {
        c2.subtitle = content;
      }
      c2.theme = App.theme.resolve(c2.theme);
      App.state.updateConfig(c2);
      App.modal.close();
    });
    document.getElementById('tx-content').focus();
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
          '<p class="hint">Le <strong>plateau</strong> est la zone où l’élève dépose ses réponses ; ' +
            'les <strong>réserves</strong> sont les bacs d’où il pioche les éléments. ' +
            'Dans chaque ligne, les largeurs réglées avec les poignées sont conservées.</p>' +
          '<div class="form-actions">' +
            '<button type="button" class="btn" data-close>Fermer</button>' +
            '<button type="button" class="btn primary" id="gd-save">Appliquer</button>' +
          '</div>' +
        '</form>'
    });
    document.getElementById('gd-save').addEventListener('click', () => {
      const c2 = cloneData(cfg());
      c2.layout = Object.assign({}, c2.layout, {
        boardCols: gridNLocal(document.getElementById('gd-board').value),
        poolsCols: gridNLocal(document.getElementById('gd-pools').value)
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

    return `
    <form id="module-form" novalidate>
      <input id="mf-zone" type="hidden" value="${zoneOk ? esc(zone) : ''}">
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
            <option value="associate" ${presetRole ? presetRole==='associate' ? 'selected' : '' : (!m||m.role==='associate'?'selected':'')}>À associer (colonne du plateau)</option>
            <option value="informative" ${presetRole ? presetRole==='informative' ? 'selected' : '' : (m&&m.role==='informative'?'selected':'')}>Informatif (panneau latéral)</option>
          </select>
        </div>
        <div class="field">
          <label>Éléments par ligne dans le bac (réserve)</label>
          <select id="mf-poolcols">
            <option value="" ${!(m&&m.poolCols)?'selected':''}>Auto — ils remplissent la largeur du bac</option>
            ${[1,2,3,4].map((n) => '<option value="' + n + '" ' + (m && m.poolCols === n ? 'selected' : '') + '>' + n + ' par ligne (contenu adapté)</option>').join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label>Verrouillage pédagogique (optionnel)</label>
        <div class="hint" style="margin-bottom:.3rem">L'élève doit d'abord avoir ouvert tous les éléments des modules cochés.</div>
        <div class="inline">
          ${others.map((o) => `
            <label class="inline" style="gap:.3rem">
              <input type="checkbox" data-unlock="${esc(o.id)}" ${unlockSet.has(o.id)?'checked':''}>
              ${esc(o.label || o.id)}
            </label>`).join('') || '<span class="hint">Aucun autre module.</span>'}
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn primary" id="mf-save">${isNew ? 'Ajouter' : 'Enregistrer'}</button>
        <button type="button" class="btn" id="mf-cancel">Annuler</button>
      </div>
    </form>`;
  }

  function bindModuleForm() {
    document.getElementById('mf-save').addEventListener('click', saveModule);
    document.getElementById('mf-cancel').addEventListener('click', hideModuleForm);
    document.getElementById('module-form').addEventListener('submit', (e) => {
      e.preventDefault();
      saveModule();
    });
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
    const payload = { id, label, kind, role, unlockAfter, poolCols: poolColsRaw ? Number(poolColsRaw) : null };

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
  function showModuleContents(moduleId) {
    const m = allMods().find((x) => x.id === moduleId);
    if (!m) return;
    const type = App.schema.Types[m.kind];
    const rows = App.state.rows();

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
        return num + '<div class="mini-info">' +
          (v.title ? '<strong>' + esc(v.title) + '</strong> ' : '') +
          esc(txt.slice(0, 160) || '(vide)') + '</div>';
      }
      if ((m.kind === 'audio' || m.kind === 'video') && v) {
        return num + '<div class="mini-info">' +
          esc(v.caption || '(sans titre)') +
          (v.src && !/^https?:/i.test(v.src)
            ? ' <span class="muted">(fichier intégré)</span>'
            : ' <span class="muted">(' + esc(v.src || 'aucune source') + ')</span>') +
          '</div>';
      }
      if (m.kind === 'url' && v) {
        return num + '<div class="mini-info">' +
          esc(v.caption || '(sans titre)') + ' — ' +
          '<a href="' + esc(v.src) + '" target="_blank" rel="noopener">' + esc(v.src) + '</a></div>';
      }
      const s = v == null ? '' : (type.summary(v) || '');
      return num + '<div class="mini-info">' + esc(s || '(vide)') + '</div>';
    }).join('<hr>');

    App.modal.open({
      title: (m.label || m.id) + ' — contenus en place (' + count + '/' + rows.length + ')',
      html: '<div class="module-contents">' + (rows.length ? items : '<p class="hint">Aucune ligne pour le moment.</p>') + '</div>'
    });
  }

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
    const mods = allMods();
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
$('#row-list').innerHTML = rows.map((r, i) => {
      const cellsHtml = mods.map((m) => cellPreviewHtml(m, r.cells[m.id])).join('');
      const isSel = String(r.id) === String(selectedRowId);
      const isFlat = flattenedRowIds.has(String(r.id));
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
                      aria-label="Descendre cette ligne" ${i===rows.length-1?'disabled':''}>↓</button>
              <button type="button" class="btn small primary" data-row-act="edit" title="Modifier"
                      aria-label="Modifier cette ligne">✎</button>
              <button type="button" class="btn small danger" data-row-act="del" title="Supprimer"
                      aria-label="Supprimer cette ligne">🗑</button>
            </div>
            <div class="row-cells">${cellsHtml || '<em class="muted">vide</em>'}</div>
          </div>
        </li>`;
    }).join('');
  }

  /* Vignette d'aperçu d'une cellule (module × ligne) */
  function cellPreviewHtml(m, v) {
    const type = App.schema.Types[m.kind];
    const label = `<div class="cell-label">${esc(m.label || m.id)}</div>`;
    const grow = Math.max(0.5, Number(m.span) || 1);
    const styleAttr = ` style="flex-grow:${grow}"`;
    const valid = Boolean(v != null && type && (!type.validate || type.validate(v)));
    const modAttr = ` data-module-id="${esc(m.id)}" title="${valid ? 'Modifier' : 'Ajouter'} ${esc(m.label || m.id)}"`;

    if (!valid) {
      return `<div class="cell-box empty"${styleAttr}${modAttr}>${label}<div class="cell-content">—</div></div>`;
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
      const title = v && v.title ? String(v.title).trim() : '';
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

    return `<div class="cell-box${boxExtraClass}"${styleAttr}${modAttr}>${label}<div class="cell-content">${content}</div></div>`;
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
    const mods = allMods();
    if (!mods.length) {
      alert('Créez d\'abord au moins un module.');
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
      alert('Erreur :\n\n• ' + (m.label || type.label) + ' : contenu manquant ou invalide');
      return;
    }

    App.state.updateRow(rowId, { [m.id]: val });
    selectedRowId = rowId;
    hideSingleCellForm();
  }

  function renderModuleFieldset(m, value) {
    const type = App.schema.Types[m.kind];
    const fields = type.formSchema(value || type.createEmpty());
    return `
      <fieldset class="module-fieldset" data-module="${esc(m.id)}">
        <legend>${esc(m.label || m.id)} <span class="badge">${esc(type.label)}</span></legend>
        ${fields.map((f) => renderField(m.id, f)).join('')}
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
      return fieldHtml(id, label, `<input id="${id}" data-field="${esc(field.name)}" type="color" value="${esc(value||'#000000')}">`);
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
            <div class="rte-toolbar">
              <button type="button" class="rte-btn" data-cmd="bold" title="Gras"><b>G</b></button>
              <button type="button" class="rte-btn" data-cmd="italic" title="Italique"><i>I</i></button>
              <button type="button" class="rte-btn" data-cmd="underline" title="Souligné"><u>S</u></button>
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
              <label class="rte-color"><input type="color" class="rte-color-input" data-color="back" value="#fef3c7"><span>Surligner</span></label>
              <button type="button" class="rte-btn" data-cmd="clear" title="Effacer la mise en forme">✕</button>
              <button type="button" class="rte-btn rte-student-preview" data-action="student-preview" title="Voir / éditer tel que vu par l'élève">👁</button>
            </div>
            <div class="rte-editor" contenteditable="true" data-placeholder="${esc(field.label||'')}">${value}</div>
          </div>
        </div>`;
    }
    return `<p class="hint">Type de champ inconnu : ${esc(field.type)}</p>`;
  }

  function fieldHtml(id, label, inputHtml) {
    return `<div class="field"><label for="${id}">${label}</label>${inputHtml}</div>`;
  }

  function bindFieldEvents(formEl) {
    formEl.addEventListener('click', (e) => {
      const previewBtn = e.target.closest('[data-action="student-preview"]');
      if (previewBtn) {
        e.preventDefault();
        e.stopPropagation();
        const rteEl = previewBtn.closest('.rte');
        if (rteEl) openStudentTextPreview(rteEl);
        return;
      }
      const btn = e.target.closest('.rte-btn');
      if (btn) {
        e.preventDefault();
        const editor = btn.closest('.rte').querySelector('.rte-editor');
        editor.focus();
        const cmd = btn.dataset.cmd;
        document.execCommand(cmd === 'clear' ? 'removeFormat' : cmd, false, null);
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
      const colorInput = e.target.closest('.rte-color-input');
      if (colorInput) {
        const editor = colorInput.closest('.rte').querySelector('.rte-editor');
        editor.focus();
        document.execCommand(colorInput.dataset.color === 'fore' ? 'foreColor' : 'hiliteColor', false, colorInput.value);
        return;
      }
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
  
  function applyRteSpanStyle(editor, cssProp, cssVal) {
    editor.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    if (!cssVal) {
      document.execCommand('removeFormat', false, null);
      return;
    }

    if (range.collapsed) {
      const span = document.createElement('span');
      span.style[cssProp] = cssVal;
      span.appendChild(document.createTextNode('\u200B'));
      range.insertNode(span);
      const newRange = document.createRange();
      newRange.setStart(span.firstChild, 1);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
      return;
    }

    const span = document.createElement('span');
    span.style[cssProp] = cssVal;
    try {
      range.surroundContents(span);
    } catch (_) {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
    sel.removeAllRanges();
    const after = document.createRange();
    after.selectNodeContents(span);
    after.collapse(false);
    sel.addRange(after);
  }

function applyRteLineHeight(editor, lineHeightVal) {
    editor.focus();
    if (!lineHeightVal) {
      editor.style.lineHeight = '';
      editor.querySelectorAll('p, div, li, blockquote').forEach((node) => {
        node.style.lineHeight = '';
      });
      return;
    }

    const sel = window.getSelection();
    let appliedToBlock = false;
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) {
        const blocks = [...editor.querySelectorAll('p, div, li, blockquote')].filter((b) =>
          range.intersectsNode(b)
        );
        if (blocks.length) {
          blocks.forEach((b) => { b.style.lineHeight = lineHeightVal; });
          appliedToBlock = true;
        }
      }
    }

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

function openStudentTextPreview(rteEl) {
    const editor = rteEl ? rteEl.querySelector('.rte-editor') : null;
    if (!editor) return;
    const rawHtml = editor.innerHTML || '';
    const currentHtml = (App.utils && typeof App.utils.sanitizeRich === 'function')
      ? App.utils.sanitizeRich(rawHtml)
      : rawHtml;

    const fieldset = rteEl.closest('.module-fieldset');
    const legendEl = fieldset ? fieldset.querySelector('legend') : null;
    const modTitle = legendEl ? legendEl.firstChild.textContent.trim() : 'Texte enrichi';

    App.modal.open({
      title: modTitle,
      html: `
        <div id="student-live-edit" class="modal-rich student-preview-surface" contenteditable="true">${currentHtml || '<p class="muted">(Texte vide)</p>'}</div>
        <div class="form-actions" style="margin-top:1rem">
          <button type="button" class="btn primary" id="apply-student-preview">Appliquer à l'éditeur</button>
          <button type="button" class="btn" data-close>Fermer</button>
        </div>`
    });

    const applyBtn = document.getElementById('apply-student-preview');
    const liveEdit = document.getElementById('student-live-edit');
    if (applyBtn && liveEdit) {
      applyBtn.addEventListener('click', () => {
        const cleaned = (App.utils && typeof App.utils.sanitizeRich === 'function')
          ? App.utils.sanitizeRich(liveEdit.innerHTML || '')
          : (liveEdit.innerHTML || '');
        editor.innerHTML = cleaned;
        App.modal.close();
      });
    }
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

  function collectModuleValue(moduleId) {
    const m = allMods().find((x) => x.id === moduleId);
    if (!m) return null;
    const type = App.schema.Types[m.kind];
    const fields = type.formSchema(type.createEmpty());
    const collected = {};
    fields.forEach((f) => {
      const id = 'f_' + moduleId + '_' + f.name;
      if (f.type === 'richtext') {
        const editor = document.querySelector(
          '[data-rte-module="' + moduleId + '"][data-rte-field="' + f.name + '"] .rte-editor');
        collected[f.name] = App.utils.sanitizeRich(editor ? editor.innerHTML : '');
      } else {
        const el = document.getElementById(id);
        collected[f.name] = el ? el.value : '';
      }
    });
    return App.schema.buildPayload(m.kind, collected);
  }

  function onSubmitRow(e) {
    e.preventDefault();
    const mods = allMods();
    const cells = {};
    for (const m of mods) {
      cells[m.id] = collectModuleValue(m.id);
    }
    const fakeRow = { id: editingRowId || 'tmp', cells };
    const errors = App.schema.validateRow(fakeRow, cfg());
    if (errors.length) {
      alert('Erreurs :\n\n' + errors.map((x) => '• ' + x.message).join('\n'));
      return;
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

    const cellBox = e.target.closest('.cell-box[data-module-id]');
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
    selectedRowId = (String(selectedRowId) === String(id)) ? null : id;
    renderRows();
  }

  function onRowListDblClick(e) {
    if (e.target.closest('button[data-row-act]')) return;
    if (e.target.closest('.cell-box[data-module-id]')) return;
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