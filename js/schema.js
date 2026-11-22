/* js/schema.js */
(function () {
  const App = (window.App = window.App || {});
  const esc = App.utils.escapeHtml;

  /* Source affichable : la référence « media:<clé> » est convertie en
     URL de blob par le magasin de médias (js/media.js). */
  function msrc(src) {
    if (App.media && typeof App.media.resolve === 'function') return App.media.resolve(src);
    return src;
  }

  const Types = {
    text: {
      label: 'Texte',
      createEmpty: () => '',
      validate: (v) => typeof v === 'string' && v.trim().length > 0,
      summary:  (v) => (typeof v === 'string' ? v : ''),
      formSchema: (v) => [
        { name: 'value', type: 'text', label: 'Texte', value: v || '', required: true }
      ],
      build: (f) => f.value,
      render: (v, ctx) =>
        '<div class="item item-text" data-item-key="' + esc(ctx.key) +
        '" data-item-type="text"><span>' + esc(v) + '</span></div>',
      open: () => {}
    },

    image: {
      label: 'Image',
      createEmpty: () => ({ src: '', caption: '' }),
      validate: (v) => !!(v && typeof v.src === 'string' && v.src.length),
      summary:  (v) => (v && v.caption) || (v && v.src ? '(image)' : ''),
      formSchema: (v) => [
        { name:'src',     type:'url-or-file', label:'Image', value:(v&&v.src)||'', accept:'image/*' },
        { name:'caption', type:'text',        label:'Légende (facultatif)', value:(v&&v.caption)||'' }
      ],
      build: (f) => ({ src: f.src, caption: f.caption || '' }),
      render: (v, ctx) => {
        const src = v && v.src ? msrc(v.src) : '';
        return '<div class="item item-image" data-item-key="' + esc(ctx.key) +
        '" data-item-type="image">' +
        (src
          ? '<img src="' + esc(src) + '" alt="" draggable="false">'
          : '<span class="slot-hint">—</span>') +
        '</div>';
      },
      open: (v) => { if (v && v.src) App.modal.openImage(msrc(v.src), v.caption || 'Image'); }
    },

    audio: {
      label: 'Son',
      createEmpty: () => ({ src: '', caption: '' }),
      validate: (v) => !!(v && typeof v.src === 'string' && v.src.length),
      summary:  (v) => (v && v.caption) || '(son)',
      formSchema: (v) => [
        { name:'src',     type:'url-or-file', label:'Audio', value:(v&&v.src)||'', accept:'audio/*' },
        { name:'caption', type:'text',        label:'Titre (facultatif)', value:(v&&v.caption)||'' }
      ],
      build: (f) => ({ src: f.src, caption: f.caption || '' }),
      render: (v, ctx) =>
        '<div class="item item-audio" data-item-key="' + esc(ctx.key) +
        '" data-item-type="audio"><span class="audio-icon">▶</span>' +
        '<span>' + esc((v && v.caption) || 'Son') + '</span></div>',
      open: (v) => App.modal.open({
        title: (v && v.caption) || 'Audio',
        html: v && v.src
          ? '<audio controls src="' + esc(msrc(v.src)) + '" style="width:100%"></audio>'
          : '<p>—</p>'
      })
    },

    video: {
      label: 'Vidéo',
      createEmpty: () => ({ src: '', caption: '' }),
      validate: (v) => !!(v && typeof v.src === 'string' && v.src.length),
      summary:  (v) => (v && v.caption) || '(vidéo)',
      formSchema: (v) => [
        { name:'src',     type:'url-or-file', label:'Vidéo (mp4 / webm)', value:(v&&v.src)||'', accept:'video/*' },
        { name:'caption', type:'text',        label:'Titre (facultatif)', value:(v&&v.caption)||'' }
      ],
      build: (f) => ({ src: f.src, caption: f.caption || '' }),
      render: (v, ctx) =>
        '<div class="item item-video" data-item-key="' + esc(ctx.key) +
        '" data-item-type="video"><span class="video-icon">▶</span>' +
        '<span>' + esc((v && v.caption) || 'Vidéo') + '</span></div>',
      open: (v) => App.modal.open({
        title: (v && v.caption) || 'Vidéo',
        html: v && v.src
          ? '<video controls src="' + esc(msrc(v.src)) + '" style="width:100%;max-height:70vh"></video>'
          : '<p>—</p>'
      })
    },

    url: {
      label: 'Page web',
      createEmpty: () => ({ src: '', caption: '' }),
      validate: (v) => !!(v && typeof v.src === 'string' && /^https?:\/\//i.test(v.src)),
      summary:  (v) => (v && v.caption) || (v && v.src) || '',
      formSchema: (v) => [
        { name:'src',     type:'url',  label:'URL (https://…)', value:(v&&v.src)||'' },
        { name:'caption', type:'text', label:'Titre (facultatif)', value:(v&&v.caption)||'' }
      ],
      build: (f) => ({ src: f.src, caption: f.caption || '' }),
      render: (v, ctx) =>
        '<div class="item item-url" data-item-key="' + esc(ctx.key) +
        '" data-item-type="url"><span class="url-icon">🌐</span>' +
        '<span>' + esc((v && v.caption) || 'Page') + '</span></div>',
      open: (v) => {
        if (!v || !v.src) return;
        App.modal.open({
          title: (v && v.caption) || 'Page web',
          html: '<iframe src="' + esc(v.src) + '" style="width:100%;height:70vh;border:0" ' +
                'sandbox="allow-scripts allow-same-origin"></iframe>' +
                '<p><a href="' + esc(v.src) + '" target="_blank" rel="noopener">Ouvrir dans un nouvel onglet</a></p>'
        });
      }
    },

    richtext: {
      label: 'Texte enrichi',
      createEmpty: () => ({ title: '', html: '' }),
      validate: (v) => !!(v && typeof v.html === 'string' &&
                          v.html.replace(/<[^>]+>/g, '').trim().length),
      summary:  (v) => (v && v.title) || (v && (v.html || '').replace(/<[^>]+>/g, '').slice(0, 60)),
      formSchema: (v) => [
        { name:'title', type:'text',     label:'Titre (facultatif)', value:(v&&v.title)||'' },
        { name:'html',  type:'richtext', label:'Contenu',            value:(v&&v.html)||'' }
      ],
      build: (f) => ({ title: f.title || '', html: App.utils.sanitizeRich(f.html || '') }),
      render: (v, ctx) =>
        '<div class="item item-info" data-item-key="' + esc(ctx.key) +
        '" data-item-type="richtext">' +
        (v && v.title ? '<strong>' + esc(v.title) + '</strong>' : '') +
        '<div class="rich clamp">' + ((v && v.html) || '') + '</div>' +
        '</div>',
      open: (v) => App.modal.open({
        title: (v && v.title) || 'Cartel',
        html: '<div class="modal-rich">' + ((v && v.html) || '') + '</div>'
      })
    }
  };

  /* =========================================================
     ADAPTATION DES VALEURS (imports JSON, data.js, résultats élèves)
     Convertit les formes des anciens exports vers le format v2 : par ex.
     un cartel en simple chaîne ou une image réduite à sa source.
     Le meilleur effort est préservé : rien n'est effacé.
     ========================================================= */
  function coerceMedia(v) {
    if (v == null) return { src: '', caption: '' };
    if (typeof v === 'string') return { src: v, caption: '' };
    if (typeof v === 'object') {
      return {
        src: String(v.src != null ? v.src : (v.url || '')),
        caption: String((v.caption != null && v.caption !== '') ? v.caption : (v.title || ''))
      };
    }
    return { src: String(v), caption: '' };
  }

  const COERCERS = {
    text(v) {
      if (v == null) return '';
      if (typeof v === 'object') {
        return App.utils.stripHtml(v.html || '') || String(v.title || '').trim();
      }
      return String(v);
    },
    image: coerceMedia,
    audio: coerceMedia,
    video: coerceMedia,
    url: coerceMedia,
    richtext(v) {
      if (v == null) return { title: '', html: '' };
      // Chaîne ancienne : HTML brut conservé tel quel (sanitizeRich l'assainit ensuite)
      if (typeof v === 'string') return { title: '', html: v };
      if (typeof v === 'object') {
        return { title: String(v.title || ''), html: String(v.html != null ? v.html : (v.text || '')) };
      }
      return { title: '', html: '<p>' + esc(String(v)) + '</p>' };
    }
  };

  App.schema = {
    Types,
    kindExists: (k) => !!Types[k],
    kindInfo:   (k) => Types[k] || null,
    coerceValue: (kind, v) => (COERCERS[kind] ? COERCERS[kind](v) : v),

    defaultConfig() {
      return {
        title: "Atelier d'association",
        subtitle: 'Glissez chaque élément dans la bonne ligne.',
        theme: App.theme.resolve({}),
        layout: { poolsSide: 'top', columns: null },
        scoring: { mode: 'all-or-nothing' },
        modules: [
          { id:'date',   kind:'text',     label:'Date',   role:'associate', required:true },
          { id:'image',  kind:'image',    label:'Image',  role:'associate' },
          { id:'cartel', kind:'richtext', label:'Cartel', role:'associate',
            unlockAfter:['image'], showLocked:true }
        ]
      };
    },

    createEmptyRow(config) {
      const cells = {};
      config.modules.filter((m) => m.role === 'associate')
        .forEach((m) => { cells[m.id] = Types[m.kind].createEmpty(); });
      return { id: App.utils.uid('r'), cells };
    },

    validateRow(row, config) {
      const errors = [];
      config.modules.forEach((m) => {
        if (m.role !== 'associate') return;
        const v = row.cells[m.id];
        if (!Types[m.kind].validate(v)) {
          errors.push({
            module: m.id,
            message: (m.label || Types[m.kind].label) + ' : contenu manquant ou invalide'
          });
        }
      });
      return errors;
    },

    buildPayload(kind, fields) { return Types[kind].build(fields); }
  };
})();