/* js/state.js */
(function () {
  const App = window.App;

  App.state = {
    data: { version: 2, updated: 0, config: null, rows: [] },
    _listeners: [],

    init() {
      this.data = App.storage.load();
      if (!this.data.config) this.data.config = App.schema.defaultConfig();
      if (!Array.isArray(this.data.rows)) this.data.rows = [];
      this._normalize();
      // Si une hydratation média est possible, l'écriture initiale peut
      // encore contenir des fichiers intégrés : on ne showAlert pas tout de suite.
      const saved = this.persist(this._canHydrate() ? { quiet: true } : null);
      if (!this._canHydrate()) return;
      const self = this;
      App.media.hydrate(this.data).then((changed) => {
        if (changed) { self._touch(); }
        if (changed || !saved) self.persist();
      });
    },

    _canHydrate() {
      return !!(App.media && App.media.available && typeof App.media.hydrate === 'function');
    },

    _normalize() {
      const cfg = this.data.config;
      cfg.modules = cfg.modules.filter((m) => App.schema.kindExists(m.kind));
      if (!cfg.modules.some((m) => m.role === 'associate')) {
        cfg.modules.push.apply(cfg.modules, App.schema.defaultConfig().modules);
      }
      // Disposition : zone des modules informatifs (migration de l'ancien réglage global infoSide)
      const legacySide = cfg.layout && cfg.layout.infoSide;
      cfg.modules.forEach((m) => {
        if (m.role === 'informative') {
          if (!['left', 'right', 'hidden'].includes(m.zone)) {
            m.zone = legacySide === 'left' ? 'left' : (legacySide === 'none' ? 'hidden' : 'right');
          }
        } else {
          delete m.zone;
        }
      });
      cfg.layout = Object.assign({}, cfg.layout);
      delete cfg.layout.infoSide;
      if (cfg.layout.poolsSide !== 'bottom') cfg.layout.poolsSide = 'top';
      cfg.theme = App.theme.resolve(cfg.theme);

      const rich = cfg.modules.filter((m) => m.kind === 'richtext');
      this.data.rows.forEach((r) => {
        if (!r.cells || typeof r.cells !== 'object') r.cells = {};
        cfg.modules.forEach((m) => {
          if (!(m.id in r.cells)) r.cells[m.id] = App.schema.Types[m.kind].createEmpty();
          else r.cells[m.id] = App.schema.coerceValue(m.kind, r.cells[m.id]);
        });
        // Données importées (JSON, data.js) : on ne fait jamais confiance au HTML reçu
        rich.forEach((m) => {
          const v = r.cells[m.id];
          if (v && typeof v.html === 'string') v.html = App.utils.sanitizeRich(v.html);
        });
      });
    },

    onChange(fn) { this._listeners.push(fn); },
    emit()       { this._listeners.forEach((fn) => fn(this.data)); },
    persist(opts) {
      const res = App.storage.save(this.data);
      if (!res.ok) {
        if (opts && opts.quiet) {
          console.warn('[state] écriture locale impossible (médias peut-être pas encore rangés).');
        } else {
          alert(
            "Le stockage du navigateur est plein.\n\n" +
            "Les fichiers importés sont normalement rangés automatiquement dans le " +
            "magasin de médias du navigateur (IndexedDB). Rechargez la page et réessayez ; " +
            "sinon, préférez des URL aux fichiers importés, ou exportez vos données en JSON."
          );
        }
      }
      this.emit();
      return res.ok;
    },
    _touch() { this.data.updated = Date.now(); },

    /* --- Config --- */
    config()          { return this.data.config; },
    updateConfig(cfg) { this.data.config = cfg; this._normalize(); this._touch(); this.persist(); },

    /* --- Lignes (API v2) --- */
    rows()            { return this.data.rows; },
    addRow(row)       { this.data.rows.push(row); this._touch(); this.persist(); },
    updateRow(id, cells) {
      const r = this.data.rows.find((x) => String(x.id) === String(id));
      if (r) { Object.assign(r.cells, cells); this._touch(); this.persist(); }
    },
    /** Réordonne les lignes selon une liste d'identifiants (ignorée si incomplète). */
    reorderRows(ids) {
      const byId = new Map(this.data.rows.map((r) => [String(r.id), r]));
      const ordered = ids.map((id) => byId.get(String(id))).filter(Boolean);
      if (ordered.length !== this.data.rows.length || new Set(ordered).size !== ordered.length) return;
      if (ordered.every((r, i) => r === this.data.rows[i])) return;
      this.data.rows = ordered;
      this._touch(); this.persist();
    },
    removeRow(id) {
      const n = this.data.rows.length;
      this.data.rows = this.data.rows.filter((x) => String(x.id) !== String(id));
      if (this.data.rows.length !== n) { this._touch(); this.persist(); }
    },
    moveRow(id, dir) {
      const i = this.data.rows.findIndex((x) => String(x.id) === String(id));
      const j = i + dir;
      if (i < 0 || j < 0 || j >= this.data.rows.length) return;
      [this.data.rows[i], this.data.rows[j]] = [this.data.rows[j], this.data.rows[i]];
      this._touch(); this.persist();
    },

    replaceAll(data) {
      // Accepte aussi l'ancien format v1 {triplets:[…]} pour les imports
      if (data && Array.isArray(data.triplets)) {
        const cfg = (this.data && this.data.config) || App.schema.defaultConfig();
        data = {
          version: 2, updated: Date.now(), config: cfg,
          rows: data.triplets.map((t) => ({
            id: t.id != null ? String(t.id) : App.utils.uid('r'),
            cells: {
              date:   String(t.date || ''),
              image:  t.image || { src: '', caption: '' },
              cartel: { title: (t.info && t.info.title) || '',
                        html:  (t.info && t.info.text)  || '' }
            }
          }))
        };
      }
      if (!data || !data.config || !Array.isArray(data.rows)) {
        throw new Error('Format de données invalide (config + rows attendus).');
      }
      this.data = data;
      this._normalize(); this._touch();
      if (this._canHydrate()) {
        const self = this;
        this.persist({ quiet: true });
        App.media.hydrate(this.data).then((changed) => {
          if (changed) { self._normalize(); self._touch(); }
          self.persist();
        });
      } else {
        this.persist();
      }
    }
  };
})();