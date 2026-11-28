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
    titleSize: 'md', titleColor: '', subtitleSize: 'md',
    titleFont: '', subtitleFont: ''
  };

  /* Styles de layout prêts à l'emploi : palettes extraites de thèmes fournis
     par le prof (schémas de couleurs KDE convertis en couleurs web). Chaque
     palette règle la couleur principale, le fond et la couleur du texte —
     réglables ensuite à la main dans le cadre « Style général ». */
  const PALETTES = {
    optimal:     { label: 'Optimal — gris anthracite',          primary: '#898989', bg: '#545454', ink: '#efefef' },
    elegantdark: { label: 'Elegant Dark — sombre et bleu doux', primary: '#96bff0', bg: '#242323', ink: '#cacaca' },
    zvonblack:   { label: 'Zvon Black — néon sur noir',         primary: '#00ff00', bg: '#000000', ink: '#c0ffff' },
    purogrey:    { label: 'Puro Grey — gris clair et prune',    primary: '#890067', bg: '#c6c6c6', ink: '#1e1e1e' },
    luckyeyes:   { label: 'Lucky Eyes — bleu profond sur clair', primary: '#00518c', bg: '#f0f0f0', ink: '#1e1e28' },
    wontonsoup:  { label: 'Wonton Soup — bleu ardoise',         primary: '#7795b3', bg: '#494e58', ink: '#b6c1d0' }
  };

  const HEX = /^#[0-9a-f]{6}$/i;
  const has = (table, key) => Object.prototype.hasOwnProperty.call(table, key);
  const pick = (table, key, def) => (has(table, key) ? key : def);

  const T = (App.theme = { FONTS, SCALES, RADII, TITLE_SIZES, SUBTITLE_SIZES, DEFAULTS, PALETTES });

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
      subtitleSize: pick(SUBTITLE_SIZES, t.subtitleSize, d.subtitleSize),
      titleFont: pick(FONTS, t.titleFont, ''),
      subtitleFont: pick(FONTS, t.subtitleFont, '')
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
      '--subtitle-size': SUBTITLE_SIZES[t.subtitleSize].v,
      '--title-font': FONTS[t.titleFont] ? FONTS[t.titleFont].css : 'var(--font)',
      '--subtitle-font': FONTS[t.subtitleFont] ? FONTS[t.subtitleFont].css : 'var(--font)'
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
