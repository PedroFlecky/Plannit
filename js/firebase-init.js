/* ================================================
   PLANNIT — Firebase Init Bridge
   Conecta o módulo firebase.js (ES module) ao
   app.js (script clássico) via window._fb
   ================================================ */

import {
  fbInitAuth,
  fbLogin,
  fbLogout,
  fbLoadOnce,
  fbScheduleSave,
  fbEnableSync,
  fbGetUid
} from './firebase.js';

// Expõe funções no escopo global para que app.js possa chamar
window._fb = {
  login:        fbLogin,
  logout:       fbLogout,
  scheduleSave: fbScheduleSave,
  getUid:       fbGetUid
};

// ── Listener de auth ──
fbInitAuth(
  // onLogin(uid, displayName, photoURL, email)
  async (uid, displayName, photoURL, email) => {
    _setLoggedUI(displayName, photoURL, email);

    // Carrega dados remotos uma vez ao logar
    await fbLoadOnce(uid, remoteData => {
      if (remoteData && typeof window._fbMergeRemote === 'function') {
        window._fbMergeRemote(remoteData);
      }
      fbEnableSync();
      if (typeof window._fbSyncReady === 'function') window._fbSyncReady();
    });
  },
  // onLogout
  () => {
    _setLoggedOutUI();
    if (typeof window._fbSyncDisabled === 'function') window._fbSyncDisabled();
  }
);

// ── Listener de status de sync (feedback visual no header) ──
window.addEventListener('fbSyncStatus', e => {
  const el = document.getElementById('syncIndicator');
  if (!el) return;
  if (e.detail === 'ok') {
    el.className = 'sync-indicator is-synced';
    el.title = 'Sincronizado ✓';
  } else {
    el.className = 'sync-indicator is-error';
    el.title = 'Erro ao sincronizar';
  }
});

// ── Helpers de UI ──
function _setLoggedUI(name, photoURL, email) {
  // Settings panel
  document.getElementById('loginRow') ?.classList.add('hidden');
  document.getElementById('loggedRow')?.classList.remove('hidden');

  const avatar = document.getElementById('userAvatar');
  if (avatar) {
    if (photoURL) { avatar.src = photoURL; avatar.style.display = ''; }
    else            avatar.style.display = 'none';
  }
  const nameEl  = document.getElementById('userName');
  const emailEl = document.getElementById('userEmail');
  if (nameEl)  nameEl.textContent  = name  || 'Usuário';
  if (emailEl) emailEl.textContent = email || '';

  const syncEl = document.getElementById('syncIndicator');
  if (syncEl) syncEl.className = 'sync-indicator is-synced';

  // Cards na aba Hoje
  document.getElementById('loginCard') ?.classList.add('hidden');
  const loggedCard = document.getElementById('loggedCard');
  if (loggedCard) loggedCard.classList.remove('hidden');

  const loggedAvatar = document.getElementById('loggedAvatar');
  if (loggedAvatar) {
    loggedAvatar.src = photoURL || '';
    loggedAvatar.style.display = photoURL ? '' : 'none';
  }
  const loggedName = document.getElementById('loggedName');
  if (loggedName) loggedName.textContent = name || 'Usuário';
}

function _setLoggedOutUI() {
  // Settings panel
  document.getElementById('loginRow') ?.classList.remove('hidden');
  document.getElementById('loggedRow')?.classList.add('hidden');
  const syncEl = document.getElementById('syncIndicator');
  if (syncEl) syncEl.className = 'sync-indicator';

  // Cards na aba Hoje
  document.getElementById('loggedCard')?.classList.add('hidden');
  document.getElementById('loginCard') ?.classList.remove('hidden');
}
