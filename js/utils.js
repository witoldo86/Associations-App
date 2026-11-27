(function () {
  const App = (window.App = window.App || {});
  const utils = (App.utils = {});

  utils.uid = function (prefix) {
    return (prefix || 'id') + '_' +
      Math.random().toString(36).slice(2, 9) +
      Date.now().toString(36).slice(-4);
  };

  utils.shuffle = function (arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  utils.escapeHtml = function (str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  utils.svgPlaceholder = function (label, color) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
      '<rect width="100%" height="100%" fill="' + color + '"/>' +
      '<text x="50%" y="50%" font-family="sans-serif" font-size="72" fill="#fff" ' +
      'text-anchor="middle" dominant-baseline="middle">' + utils.escapeHtml(label) + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };

  /* =========================================================
     SANITIZEUR HTML — formatage simple uniquement
     - parse dans un <template> (document inerte : aucun onerror/onload ne se déclenche)
     - les enfants sont nettoyés AVANT de déplier une balise interdite
     - script/style/iframe… sont supprimés avec leur contenu
     ========================================================= */
  const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'SPAN', 'P', 'DIV', 'IMG']);
  const SAFE_SRC_RE = /^(https?:\/\/|data:image\/|media:)/i;
  const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH']);
  const ALLOWED_STYLES = ['color', 'background-color', 'font-weight', 'font-style',
    'text-decoration', 'font-family', 'font-size', 'line-height', 'text-align'];

  function cleanNode(node) {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 3) return;                       // texte
      if (child.nodeType !== 1) { child.remove(); return; }   // commentaires, etc.
      if (DROP_TAGS.has(child.tagName.toUpperCase())) { child.remove(); return; }

      cleanNode(child);                                       // d'abord les enfants

      /* <font color=… face=…> (forme produite par certains navigateurs
         pour la couleur de texte) : convertie en <span style=…> au lieu
         d'être dépliée — sinon la couleur choisie était perdue à
         l'enregistrement et le texte revenait au noir. */
      if (child.tagName === 'FONT') {
        cleanNode(child);
        const span = document.createElement('span');
        const color = child.getAttribute('color') || '';
        const face = child.getAttribute('face') || '';
        if (color) span.style.color = color;      // validé par le parseur CSS
        if (face) span.style.fontFamily = face;
        [...child.childNodes].forEach((n) => span.appendChild(n));
        child.replaceWith(span);
        return;
      }
      if (child.tagName === 'IMG') {
        const alt = child.getAttribute('alt') || '';
        const src = String(child.getAttribute('src') || '').trim();
        [...child.attributes].forEach((a) => child.removeAttribute(a.name));
        const imgStyles = [];
        ALLOWED_STYLES.forEach((prop) => {
          const val = child.style.getPropertyValue(prop);
          if (val && val.indexOf('url(') === -1 &&
              val.toLowerCase().indexOf('javascript:') === -1) imgStyles.push(prop + ': ' + val);
        });
        if (SAFE_SRC_RE.test(src)) child.setAttribute('src', src);
        child.setAttribute('alt', alt);
        if (imgStyles.length) child.setAttribute('style', imgStyles.join('; '));
        return;
      }
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...child.childNodes);               // puis on déplie
        return;
      }
      const kept = [];
      ALLOWED_STYLES.forEach((prop) => {
        const val = child.style.getPropertyValue(prop);
        if (val && val.indexOf('url(') === -1 &&
            val.toLowerCase().indexOf('javascript:') === -1) kept.push(prop + ': ' + val);
      });
      [...child.attributes].forEach((a) => child.removeAttribute(a.name));
      if (kept.length) child.setAttribute('style', kept.join('; '));
    });
  }

  utils.sanitizeRich = function (html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html == null ? '' : html);
    cleanNode(tpl.content);
    const box = document.createElement('div');
    box.appendChild(tpl.content);
    return box.innerHTML;
  };

  /* Fichiers du magasin de médias : toute référence « media: » d'un fragment
     HTML est remplacée par une URL affichable (blob:), pour l'affichage. */
  utils.resolveMediaInHtml = function (html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html == null ? '' : html);
    if (App.media && typeof App.media.resolve === 'function') {
      tpl.content.querySelectorAll('[src^="media:"]').forEach((el) => {
        const out = App.media.resolve(el.getAttribute('src'));
        if (out) el.setAttribute('src', out);
      });
    }
    const box = document.createElement('div');
    box.appendChild(tpl.content);
    return box.innerHTML;
  };

  /* Sens inverse, pour l'enregistrement : les images insérées par l'éditeur
     portent une URL « blob: » affichable ; on la reconvertit en référence
     légère « media: » quand le magasin la connaît. */
  utils.htmlWithMediaRefs = function (html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html == null ? '' : html);
    if (App.media && typeof App.media.reverse === 'function') {
      tpl.content.querySelectorAll('img[src^="blob:"]').forEach((img) => {
        const ref = App.media.reverse(img.getAttribute('src'));
        if (ref) img.setAttribute('src', ref);
      });
    }
    const box = document.createElement('div');
    box.appendChild(tpl.content);
    return box.innerHTML;
  };

  /** Texte brut d'un fragment HTML (aperçus, résumés). */
  utils.stripHtml = function (html) {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  };

  /** Couleur de texte lisible sur un fond donné (bandeaux colorés) :
     encre foncée sur les fonds clairs, blanc sur les fonds foncés. */
  utils.contrastText = function (hex) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return '#1f2937';
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#1f2937' : '#ffffff';
  };

  /** Téléchargement d'un fichier généré (l'URL n'est révoquée qu'après le clic). */
  utils.download = function (filename, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime || 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** Lecture sûre de localStorage (mode privé, quota…). */
  utils.safeStorage = {
    get(k)    { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    remove(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
})();
