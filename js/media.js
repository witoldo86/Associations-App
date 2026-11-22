/* js/media.js — Magasin de médias (IndexedDB)
   But : ne plus saturer le stockage local (localStorage ≈ 5 Mo).
   Les fichiers choisis par l'enseignant (images, sons, vidéos) sont
   rangés comme <blob> dans IndexedDB (centaines de Mo disponibles),
   et les cellules ne gardent qu'une référence légère « media:<clé> ».
   - resolve(src)  : référence → URL utilisable dans <img>/<audio>/<video>
   - hydrate(data) : détecte les anciennes sources « data: » (base64)
                     et les déplace dans le magasin
   - inline(data)  : reconstruit un jeu de données autonome avec les
                     fichiers réintégrés en « data: » (exports JSON / data.js)
   Sans IndexedDB (ancien navigateur, navigation privée) tout passe en
   mode transparent : les « data: » restent en place comme avant. */
(function () {
  const App = (window.App = window.App || {});
  const DB_NAME = 'assoc3-media';
  const STORE = 'medias';
  const PREFIX = 'media:';

  const blobs = new Map();  // clé -> Blob (référence, lisible à la demande)
  const urls = new Map();   // clé -> blob: URL pour <img>/<audio>/<video>
  let dbPromise = null;
  let usable = typeof indexedDB !== 'undefined' && !!indexedDB;

  function openDb() {
    if (!usable) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB_NAME, 1); }
      catch (e) { usable = false; return resolve(null); }
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore(STORE); } catch (e) { /* déjà créée */ }
      };
      req.onsuccess = () => {
        try {
          req.result.onversionchange = () => {
            try { req.result.close(); } catch (e) { /* ignoré */ }
          };
        } catch (e) { /* ignoré */ }
        resolve(req.result);
      };
      req.onerror = () => { usable = false; dbPromise = null; resolve(null); };
      req.onblocked = () => { resolve(null); };
    });
    return dbPromise;
  }

  function tx(db, mode) {
    try { return db.transaction(STORE, mode).objectStore(STORE); }
    catch (e) { return null; }
  }

  function reqPromise(request, onOk) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(onOk ? onOk(request.result) : request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function newKey() {
    return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function cacheBlob(key, blob) {
    blobs.set(key, blob);
    if (!urls.has(key) && typeof URL !== 'undefined' && URL.createObjectURL) {
      try { urls.set(key, URL.createObjectURL(blob)); } catch (e) { /* blob illisible */ }
    }
  }

  function revokeAll() {
    if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
      urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { /* ignoré */ } });
    }
    urls.clear();
    blobs.clear();
  }

  function newRecord(blob, name) {
    return {
      key: newKey(),
      name: String(name || 'fichier'),
      type: blob.type || 'application/octet-stream',
      size: blob.size || 0,
      created: Date.now(),
      blob: blob
    };
  }

  /** data: URL (base64 ou texte, paramètres acceptés) -> Blob. Synchrone ; null si illisible. */
  function dataUrlToBlob(dataUrl) {
    const s = String(dataUrl);
    const comma = s.indexOf(',');
    if (s.indexOf('data:') !== 0 || comma < 0) return null;
    const params = s.slice(5, comma).split(';');
    const mime = params.shift() || 'application/octet-stream';
    const isB64 = params.indexOf('base64') !== -1;
    const payload = s.slice(comma + 1);
    if (isB64) {
      try {
        const bin = atob(payload);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: mime });
      } catch (e) { return null; }
    }
    try { return new Blob([decodeURIComponent(payload)], { type: mime }); }
    catch (e) { return new Blob([payload], { type: mime }); }
  }

  /** Blob -> data: URL (pour les exports autonomes). */
  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      if (typeof FileReader === 'undefined' || !blob) return resolve(null);
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || '') || null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  }

  function preload(db) {
    const store = tx(db, 'readonly');
    if (!store) return;
    reqPromise(store.getAll(), (records) => records || [])
      .then((records) => {
        records.forEach((rec) => {
          if (rec && rec.key && rec.blob) cacheBlob(rec.key, rec.blob);
        });
        /* Le premier rendu peut survenir avant la fin de ce préchargement
           (affichage asynchrone) : les références « media: » étaient alors
           affichées vides jusqu'au prochain re-rendu. On relance un rendu
           de rattrapage dès que les fichiers sont disponibles. */
        if (records.length && App.state && typeof App.state.emit === 'function') {
          App.state.emit();
        }
      })
      .catch((e) => console.warn('[media] préchargement impossible', e));
  }

  openDb().then((db) => { if (db) preload(db); });

  const api = {
    get available() { return usable; },
    PREFIX: PREFIX,

    /* Range un fichier sur le disque du navigateur (IndexedDB)
       et renvoie la référence légère « media:<clé> ». */
    put(blob, name) {
      return openDb().then((db) => {
        if (!db || !blob) throw new Error('Magasin de médias indisponible.');
        const rec = newRecord(blob, name);
        const store = tx(db, 'readwrite');
        if (!store) throw new Error('Magasin de médias indisponible.');
        return reqPromise(store.put(rec, rec.key)).then(() => {
          cacheBlob(rec.key, rec.blob);
          return PREFIX + rec.key;
        });
      });
    },

    putFile(file) { return api.put(file, file && file.name); },

    /* Référence « media:<clé> » -> URL affichable (synchrone).
       Toute autre source (http, data:, blob:) est renvoyée telle quelle. */
    resolve(src) {
      if (typeof src !== 'string' || src.indexOf(PREFIX) !== 0) return src;
      const url = urls.get(src.slice(PREFIX.length));
      return url != null ? url : '';
    },

    /* Déplace les sources « data: » intégrées aux cellules vers le
       magasin ; renvoie true si au moins une cellule a été allégée.
       Les cellules ne sont modifiées qu'après enregistrement réussi. */
    hydrate(data) {
      return openDb().then((db) => {
        if (!db || !data || !Array.isArray(data.rows)) return false;
        const ops = [];
        data.rows.forEach((row) => {
          const cells = row && row.cells;
          if (!cells || typeof cells !== 'object') return;
          Object.keys(cells).forEach((id) => {
            const v = cells[id];
            if (!v || typeof v !== 'object' || typeof v.src !== 'string') return;
            if (v.src.indexOf('data:') !== 0) return;
            if (v.src.indexOf(PREFIX) === 0) return;
            const blob = dataUrlToBlob(v.src);
            if (!blob) return;
            const rec = newRecord(blob, 'cellule-' + id);
            ops.push({ rec, cell: v });
          });
        });
        if (!ops.length) return false;
        const store = tx(db, 'readwrite');
        if (!store) return false;
        const puts = ops.map((op) =>
          reqPromise(store.put(op.rec, op.rec.key)).then(() => {
            cacheBlob(op.rec.key, op.rec.blob);
            op.cell.src = PREFIX + op.rec.key;
            return true;
          }).catch((e) => { console.warn('[media] rangement impossible', e); return false; })
        );
        return Promise.all(puts).then((results) => results.indexOf(true) !== -1);
      });
    },

    /* Recopie profonde du jeu de données avec les références « media: »
       réintégrées en « data: » (exports JSON / data.js autonomes). */
    inline(data) {
      return openDb().then((db) => {
        if (!data) return data;
        let out;
        try { out = JSON.parse(JSON.stringify(data)); }
        catch (e) { return data; }
        if (!db || !Array.isArray(out.rows)) return out;
        const jobs = [];
        out.rows.forEach((row) => {
          const cells = row && row.cells;
          if (!cells || typeof cells !== 'object') return;
          Object.keys(cells).forEach((id) => {
            const v = cells[id];
            if (!v || typeof v !== 'object' || typeof v.src !== 'string') return;
            if (v.src.indexOf(PREFIX) !== 0) return;
            const key = v.src.slice(PREFIX.length);
            const work = new Promise((done) => {
              const put = (blob) => blobToDataUrl(blob).then((d) => { if (d) v.src = d; done(); });
              const cached = blobs.get(key);
              if (cached) { put(cached).catch(() => done()); return; }
              const store = tx(db, 'readonly');
              if (!store) return done();
              reqPromise(store.get(key))
                .then((rec) => (rec && rec.blob ? put(rec.blob) : done()))
                .catch(() => done());
            });
            jobs.push(work);
          });
        });
        return Promise.all(jobs).then(() => out);
      });
    },

    /* Vide entièrement le magasin (menu « Tout effacer »). */
    clear() {
      return openDb().then((db) => {
        revokeAll();
        if (!db) return;
        const store = tx(db, 'readwrite');
        if (!store) return;
        reqPromise(store.clear())
          .catch((e) => console.warn('[media] vidage impossible', e));
      });
    }
  };

  App.media = api;
})();
