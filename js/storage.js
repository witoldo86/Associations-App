/* js/storage.js */
(function () {
  const App = (window.App = window.App || {});
  const KEY = 'assoc3:v2';
  const OLD_KEY = 'assoc3:v1';

  App.storage = {
    KEY,

    load() {
      const seed = window.ASSOC3_SEED;
      const seedValide = !!(seed && seed.config && Array.isArray(seed.rows));

      // 1) Cache localStorage
      let cache = null;
      try {
        const raw = App.utils.safeStorage.get(KEY);
        if (raw) cache = JSON.parse(raw);
        if (!(cache && cache.config && Array.isArray(cache.rows))) cache = null;
      } catch (e) {
        console.warn('[storage] lecture v2 impossible', e);
        cache = null;
      }

      // 2) data.js présent : on prend le plus récent des deux
      if (seedValide) {
        const seedDate = seed.updated || 0;
        const cacheDate = cache ? (cache.updated || 0) : -1;
        if (!cache || seedDate >= cacheDate) {
          console.info('[storage] data.js chargé (plus récent ou égal au cache).');
          return this.seedData();
        }
        console.info('[storage] cache localStorage retenu (plus récent que data.js).');
        return cache;
      }

      // 3) Pas de data.js : migration v1 puis démo
      try {
        const old = App.utils.safeStorage.get(OLD_KEY);
        if (old) {
          const o = JSON.parse(old);
          if (o && Array.isArray(o.triplets)) {
            const migrated = this.migrateV1(o);
            this.save(migrated);
            console.info('[storage] migration v1 → v2 effectuée (' + migrated.rows.length + ' lignes).');
            return migrated;
          }
        }
      } catch (e) { console.warn('[storage] migration impossible', e); }

      return this.seedData();
    },

    save(data) {
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
        return { ok: true };
      } catch (e) {
        console.warn('[storage] écriture impossible', e);
        return { ok: false, error: e };
      }
    },

    defaultData() {
      return {
        version: 2,
        updated: Date.now(),
        config: App.schema.defaultConfig(),
        rows: this.demoRows()
      };
    },

    /* Ancien format {triplets:[{date,image,info}]} → v2 */
    migrateV1(old) {
      const config = App.schema.defaultConfig();
      const rows = old.triplets.map((t) => ({
        id: t.id != null ? String(t.id) : App.utils.uid('r'),
        cells: {
          date:   String(t.date || ''),
          image:  { src:(t.image && t.image.src) || '', caption:(t.image && t.image.caption) || '' },
          cartel: { title:(t.info && t.info.title) || '',
                    html:  (t.info && t.info.text)  || '' }
        }
      }));
      return { version: 2, updated: Date.now(), config, rows };
    },

    /* Données issues de data.js (window.ASSOC3_SEED) si présent, sinon démo */
    seedData() {
      const raw = window.ASSOC3_SEED;
      if (!raw) return this.defaultData();
      // Copie : l'état ne doit jamais modifier l'objet global window.ASSOC3_SEED
      const s = typeof structuredClone === 'function' ? structuredClone(raw) : JSON.parse(JSON.stringify(raw));

      if (s.config && Array.isArray(s.rows)) {
        return { version: 2, updated: s.updated || 0, config: s.config, rows: s.rows };
      }

      if (Array.isArray(s.triplets)) {
        return this.migrateV1(s);
      }

      console.warn('[storage] ASSOC3_SEED présent mais format inattendu', s);
      return this.defaultData();
    },

    demoRows() {
      if (!App.utils || !App.utils.uid || !App.utils.svgPlaceholder) return [];
      const mk = (date, color, label, title, html) => ({
        id: App.utils.uid('r'),
        cells: {
          date: String(date),
          image: { src: App.utils.svgPlaceholder(label, color), caption: '' },
          cartel: { title, html }
        }
      });
      return [
        mk('1789', '#2563eb', '1789', 'La Révolution française',
          "<p>Ouverture des États généraux, prise de la Bastille le 14 juillet : l'Ancien Régime s'effondre.</p>"),
        mk('1969', '#7c3aed', '1969', 'Premiers pas sur la Lune',
          '<p>Le 21 juillet 1969, Neil Armstrong pose le pied sur la Lune.</p>'),
        mk('1889', '#0891b2', '1889', 'La tour Eiffel',
          "<p>Construite pour l'Exposition universelle de 1889, elle devient le symbole de Paris.</p>")
      ];
    }
  };
})();