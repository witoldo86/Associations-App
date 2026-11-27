(function () {
  const App = window.App;

  App.modal = {
    root: null,
    _imageObserver: null,

    init() {
      this.root = document.getElementById('modal-root');

      this.root.addEventListener('click', (e) => {
        if (e.target.hasAttribute('data-close') ||
            e.target.classList.contains('modal-backdrop')) {
          this.close();
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.close();
      });
    },

    /** Modal standard (texte, HTML arbitraire) */
    open(opts) {
      this.close();
      const title = App.utils.escapeHtml(opts.title || '');
      /* Couleur de l'étiquette de titre (barre supérieure de la fenêtre),
         choisie par le prof pour les modules de texte enrichi. */
      const tc = (typeof opts.titleColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(opts.titleColor))
        ? ' style="color:' + opts.titleColor + '"' : '';
      this.root.innerHTML =
        '<div class="modal-backdrop">' +
          '<div class="modal' + (opts.wide === true ? ' modal-wide' : '') +
          '" role="dialog" aria-modal="true">' +
            '<div class="modal-head">' +
              '<h3' + tc + '>' + title + '</h3>' +
              '<button type="button" class="modal-close" data-close aria-label="Fermer">✕</button>' +
            '</div>' +
            '<div class="modal-body">' + (opts.html || '') + '</div>' +
          '</div>' +
        '</div>';
    },

    /** Visualisation large avec en-tête compact, zoom centré (100 %–400 %) et déplacement main. */
    openImage(src, title) {
      this.close();
      const t = App.utils.escapeHtml(title || 'Image');
      const s = App.utils.escapeHtml(src || '');
      this.root.innerHTML = `
        <div class="modal-backdrop modal-backdrop-image">
          <div class="modal-image" role="dialog" aria-modal="true" aria-labelledby="image-view-title">
            <div class="modal-head">
              <h3 id="image-view-title">${t}</h3>
              <button type="button" class="modal-close" data-close aria-label="Fermer">✕</button>
            </div>
            <div class="modal-image-zoombar">
              <label for="image-zoom">Zoom</label>
              <input id="image-zoom" type="range" min="100" max="400" step="10" value="100"
                aria-label="Niveau de zoom">
              <output for="image-zoom" id="image-zoom-value">100 %</output>
              <button type="button" class="btn small" id="image-zoom-reset">Ajuster</button>
            </div>
            <div class="modal-image-body" id="image-zoom-viewport"
              tabindex="0" role="region" aria-label="Image agrandie, zone défilante"
              style="display:block;overflow:auto;position:relative;">
              <div id="image-zoom-stage" style="position:relative;margin:auto;">
                <img id="image-zoom-picture" src="${s}" alt="${t}" draggable="false"
                  style="position:absolute;max-width:none;max-height:none;object-fit:contain;display:block;">
              </div>
            </div>
          </div>
        </div>`;

      const modalBox = this.root.querySelector('.modal-image');
      const image = this.root.querySelector('#image-zoom-picture');
      const layoutCfg = (App.state && App.state.config && App.state.config().layout) || {};
      const isCompact = layoutCfg.imageModal === 'compact';
      modalBox.classList.toggle('is-compact', isCompact);
      const viewport = this.root.querySelector('#image-zoom-viewport');
      const stage = this.root.querySelector('#image-zoom-stage');
      const slider = this.root.querySelector('#image-zoom');
      const output = this.root.querySelector('#image-zoom-value');
      let previousWidth = 0;
      let previousHeight = 0;
      let isPanning = false;
      let panStartX = 0;
      let panStartY = 0;
      let panStartScrollLeft = 0;
      let panStartScrollTop = 0;

      const update = (reset = false) => {
        if (!image.naturalWidth || !image.naturalHeight) return;
        const zoom = Number(slider.value);

       if (isCompact && zoom === 100 && !previousWidth) {
          const maxW = Math.max(280, window.innerWidth * 0.92 - 40);
          const maxH = Math.max(220, window.innerHeight * 0.78);
          const fitRatio = Math.min(maxW / image.naturalWidth, maxH / image.naturalHeight);
          const baseW = Math.max(240, Math.round(image.naturalWidth * fitRatio));
          const baseH = Math.max(160, Math.round(image.naturalHeight * fitRatio));
          modalBox.style.width = (baseW + 8) + 'px';
          viewport.style.width = baseW + 'px';
          viewport.style.height = baseH + 'px';
        }

        const vw = viewport.clientWidth;
        const vh = viewport.clientHeight;
        if (!vw || !vh) return;
        const centerX = previousWidth ? (viewport.scrollLeft + vw / 2) / previousWidth : .5;
        const centerY = previousHeight ? (viewport.scrollTop + vh / 2) / previousHeight : .5;
        const fit = Math.min(vw / image.naturalWidth, vh / image.naturalHeight);
        const width = image.naturalWidth * fit * zoom / 100;
        const height = image.naturalHeight * fit * zoom / 100;
        const stageWidth = Math.max(vw, width);
        const stageHeight = Math.max(vh, height);
        stage.style.width = stageWidth + 'px';
        stage.style.height = stageHeight + 'px';
        image.style.width = width + 'px';
        image.style.height = height + 'px';
        image.style.left = (stageWidth - width) / 2 + 'px';
        image.style.top = (stageHeight - height) / 2 + 'px';
        output.value = zoom + ' %';
        slider.setAttribute('aria-valuetext', zoom + ' %');
        viewport.scrollLeft = reset ? 0 : centerX * stageWidth - vw / 2;
        viewport.scrollTop = reset ? 0 : centerY * stageHeight - vh / 2;
        previousWidth = stageWidth;
        previousHeight = stageHeight;

        const canPan = zoom > 100;
        viewport.classList.toggle('is-zoomed', canPan);
        if (!canPan && isPanning) {
          isPanning = false;
          viewport.classList.remove('is-panning');
        }
      };

      viewport.addEventListener('pointerdown', (e) => {
        if (Number(slider.value) <= 100) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        // Sans preventDefault, un glissement SUR l'image lance le drag natif
        // du navigateur (pointercancel) et la main ne fait rien.
        e.preventDefault();
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panStartScrollLeft = viewport.scrollLeft;
        panStartScrollTop = viewport.scrollTop;
        viewport.classList.add('is-panning');
        viewport.setPointerCapture(e.pointerId);
      });

      viewport.addEventListener('pointermove', (e) => {
        if (!isPanning) return;
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        viewport.scrollLeft = panStartScrollLeft - dx;
        viewport.scrollTop = panStartScrollTop - dy;
      });

      const stopPan = (e) => {
        if (!isPanning) return;
        isPanning = false;
        viewport.classList.remove('is-panning');
        if (e && e.pointerId != null && viewport.hasPointerCapture(e.pointerId)) {
          viewport.releasePointerCapture(e.pointerId);
        }
      };

      viewport.addEventListener('pointerup', stopPan);
      viewport.addEventListener('pointercancel', stopPan);

      image.addEventListener('load', () => {
        previousWidth = 0;
        previousHeight = 0;
        update(true);
      }, { once: true });
      slider.addEventListener('input', () => update());
      this.root.querySelector('#image-zoom-reset').addEventListener('click', () => {
        slider.value = '100';
        previousWidth = 0;
        previousHeight = 0;
        update(true);
      });
      if (typeof ResizeObserver !== 'undefined') {
        this._imageObserver = new ResizeObserver(() => update());
        this._imageObserver.observe(viewport);
      }
      if (image.complete) {
        previousWidth = 0;
        previousHeight = 0;
        update(true);
      }
      this.root.querySelector('[data-close]').focus();
    },

    close() {
      if (this._imageObserver) {
        this._imageObserver.disconnect();
        this._imageObserver = null;
      }
      if (!this.root) return;
      this.root.innerHTML = '';
    }
  };
})();