/* js/theme.js — thème partagé par l'espace élève, l'espace prof et l'aperçu de la maquette */
(function () {
  const App = (window.App = window.App || {});

  const FONTS = {
    system:   { label: 'Système (sans-serif)',   css: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" },
    serif:    { label: 'Classique (serif)',      css: "Georgia,'Times New Roman',serif" },
    humanist: { label: 'Humaniste',              css: "'Trebuchet MS',Verdana,sans-serif" },
    mono:     { label: 'Machine à écrire',       css: "'Courier New',ui-monospace,monospace" }
  };
  const SCALES = {
    small:  { label: 'Petit',      v: 0.9 },
    normal: { label: 'Normal',     v: 1 },
    large:  { label: 'Grand',      v: 1.12 },
    xlarge: { label: 'Très grand', v: 1.25 }
  };
  const RADII = {
    square: { label: 'Angles droits',      v: '4px' },
    soft:   { label: 'Arrondis (défaut)',  v: '12px' },
    round:  { label: 'Très arrondis',      v: '20px' }
  };
  const TITLE_SIZES = {
    sm: { label: 'Petit',      v: '.95rem' },
    md: { label: 'Normal',     v: '1.05rem' },
    lg: { label: 'Grand',      v: '1.5rem' },
    xl: { label: 'Très grand', v: '2rem' }
  };
  const SUBTITLE_SIZES = {
    sm: { label: 'Petite',      v: '.8rem' },
    md: { label: 'Normale',     v: '.9rem' },
    lg: { label: 'Grande',      v: '1.1rem' },
    xl: { label: 'Très grande', v: '1.3rem' }
  };

  const DEFAULTS = {
    primary: '#2563eb', bg: '#f4f6f9', ink: '#1f2937',
    font: 'system', scale: 'normal', radius: 'soft',
    titleSize: 'md', titleColor: '', subtitleSize: 'md'
  };

  const HEX = /^#[0-9a-f]{6}$/i;
  const has = (table, key) => Object.prototype.hasOwnProperty.call(table, key);
  const pick = (table, key, def) => (has(table, key) ? key : def);

  const T = (App.theme = { FONTS, SCALES, RADII, TITLE_SIZES, SUBTITLE_SIZES, DEFAULTS });

  /** Complète et valide un thème (clés manquantes ou invalides → valeurs par défaut). */
  T.resolve = function (t) {
    t = t || {};
    const d = DEFAULTS;
    return {
      primary: HEX.test(t.primary) ? t.primary : d.primary,
      bg: HEX.test(t.bg) ? t.bg : d.bg,
      ink: HEX.test(t.ink) ? t.ink : d.ink,
      font: pick(FONTS, t.font, d.font),
      scale: pick(SCALES, t.scale, d.scale),
      radius: pick(RADII, t.radius, d.radius),
      titleSize: pick(TITLE_SIZES, t.titleSize, d.titleSize),
      titleColor: HEX.test(t.titleColor) ? t.titleColor : '',
      subtitleSize: pick(SUBTITLE_SIZES, t.subtitleSize, d.subtitleSize)
    };
  };

  T.scaleValue = (key) => SCALES[pick(SCALES, key, 'normal')].v;

  /** Variables CSS correspondant à un thème. */
  T.vars = function (theme) {
    const t = T.resolve(theme);
    return {
      '--primary': t.primary,
      '--bg': t.bg,
      '--ink': t.ink,
      '--font': FONTS[t.font].css,
      '--scale': String(SCALES[t.scale].v),
      '--radius': RADII[t.radius].v,
      '--title-size': TITLE_SIZES[t.titleSize].v,
      '--title-color': t.titleColor || 'var(--ink)',
      '--subtitle-size': SUBTITLE_SIZES[t.subtitleSize].v
    };
  };

  /** Applique le thème et le titre à toute la page (espaces élève ET prof). */
  T.apply = function (cfg) {
    if (!cfg) return;
    const style = document.documentElement.style;
    const vars = T.vars(cfg.theme);
    Object.keys(vars).forEach((k) => style.setProperty(k, vars[k]));
    const h1 = document.querySelector('.app-header h1');
    if (h1 && cfg.title) h1.textContent = cfg.title;
  };
})();
