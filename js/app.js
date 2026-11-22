/* js/app.js */
(function () {
  const App = window.App;
  const TEACHER_CODE = '2468';
  let currentMode = 'student';

  /* --- Cadenas : accès prof mémorisé (bascule 🔒 / 🔓) --- */
  const LOCK_KEY = 'assoc3:unlocked';
  const store = App.utils.safeStorage;
  const isUnlocked = () => store.get(LOCK_KEY) === '1';

  function setLockIcon() {
    const btn = document.getElementById('btn-lock');
    if (!btn) return;
    btn.textContent = isUnlocked() ? '🔓' : '🔒';
    btn.setAttribute('aria-label',
      isUnlocked() ? 'Accès prof libre, cliquer pour verrouiller'
                   : 'Accès prof verrouillé, cliquer pour déverrouiller');
  }

  function switchMode(mode) {
    currentMode = mode;
    document.body.classList.toggle('student-mode', mode === 'student');
    document.querySelectorAll('.mode-switch button').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === mode);
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });
    document.getElementById('view-teacher').hidden = mode !== 'teacher';
    document.getElementById('view-student').hidden = mode !== 'student';
  }

  document.addEventListener('DOMContentLoaded', () => {
    App.modal.init();

    // 1) Charger l'état AVANT tout montage
    try { App.state.init(); } catch (e) { console.error('[state.init]', e); }
    try {
      App.theme.apply(App.state.config());
      App.state.onChange(() => App.theme.apply(App.state.config()));
    } catch (e) { console.error('[theme]', e); }

    // 2) Monter chaque vue isolément
    try { App.teacher.mount(document.getElementById('view-teacher')); }
    catch (e) { console.error('[teacher.mount]', e); }
    try { App.student.mount(document.getElementById('view-student')); }
    catch (e) { console.error('[student.mount]', e); }

    // 3) Notifier les vues que l'état est prêt
    try { App.state.emit(); } catch (e) { console.error('[state.emit]', e); }

    const dialog = document.createElement('dialog');
    dialog.className = 'teacher-access';
    dialog.setAttribute('aria-labelledby', 'access-title');
    dialog.innerHTML = `
      <form id="teacher-access-form">
        <h2 id="access-title">Accès à l'espace prof</h2>
        <div class="field">
          <label for="teacher-code">Code d'accès</label>
          <input id="teacher-code" type="password" autocomplete="off" required autofocus
            aria-describedby="teacher-code-error">
        </div>
        <p id="teacher-code-error" class="access-error" role="alert"></p>
        <div class="form-actions">
          <button type="button" class="btn" id="access-cancel">Annuler</button>
          <button type="submit" class="btn primary">Entrer</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    const input = dialog.querySelector('input');
    const error = dialog.querySelector('[role="alert"]');
    dialog.querySelector('#access-cancel').addEventListener('click', () => dialog.close());
    dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      if (input.value !== TEACHER_CODE) {
        error.textContent = 'Code incorrect. Réessayez.';
        input.setAttribute('aria-invalid', 'true');
        input.select();
        return;
      }
      dialog.close();
      switchMode('teacher');
    });
    dialog.addEventListener('close', () => { input.value = ''; });

    // Clic sur « Espace prof » : sans code si le cadenas est ouvert
    document.querySelectorAll('.mode-switch button').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.mode === 'teacher' && currentMode !== 'teacher') {
          if (isUnlocked()) { switchMode('teacher'); return; }
          input.value = '';
          input.removeAttribute('aria-invalid');
          error.textContent = '';
          dialog.showModal();
        } else if (button.dataset.mode === 'student') {
          switchMode('student');
        }
      });
    });

    // Le bouton cadenas ouvre/ferme l'accès libre à l'espace prof
    const lockBtn = document.getElementById('btn-lock');
    if (lockBtn) {
      lockBtn.addEventListener('click', () => {
        if (isUnlocked()) {
          store.remove(LOCK_KEY);
          if (currentMode === 'teacher') switchMode('student');
        } else {
          store.set(LOCK_KEY, '1');
        }
        setLockIcon();
      });
      setLockIcon();
    }

    switchMode('student');
  });
})();