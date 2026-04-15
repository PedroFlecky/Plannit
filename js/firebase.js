/* ================================================
   PLANNIT — Firebase Integration
   Auth (Google) + Firestore sync automático
   ================================================ */

import { initializeApp }                          from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
         setPersistence, browserLocalPersistence }
                                                   from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot }
                                                   from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

// ── Configuração do projeto ──
const firebaseConfig = {
  apiKey:            "AIzaSyCmaxsj0U-v3-we_sN3PlDi0dr-afK5kSE",
  authDomain:        "plannit-2ce53.firebaseapp.com",
  projectId:         "plannit-2ce53",
  storageBucket:     "plannit-2ce53.firebasestorage.app",
  messagingSenderId: "347232479011",
  appId:             "1:347232479011:web:7fee20f81361f7354c4e96"
};

const fbApp  = initializeApp(firebaseConfig);
const auth   = getAuth(fbApp);
const db     = getFirestore(fbApp);

// Garante que o token de auth persista entre sessões do browser
setPersistence(auth, browserLocalPersistence).catch(err =>
  console.warn('Auth persistence error:', err)
);

// ── Estado de sync ──
let _fbUid         = null;   // UID do usuário logado (null = deslogado)
let _syncEnabled   = false;  // true após primeiro load do Firestore
let _saveTimer     = null;   // debounce do upload
let _unsubSnapshot = null;   // função para cancelar listener em tempo real

// ════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════

/** Inicia login com Google via popup */
export function fbLogin() {
  const provider = new GoogleAuthProvider();
  signInWithPopup(auth, provider).catch(err => {
    console.error('Login error', err);
    // Feedback visual tratado pelo onAuthStateChanged
  });
}

/** Faz logout */
export function fbLogout() {
  if (_unsubSnapshot) { _unsubSnapshot(); _unsubSnapshot = null; }
  _fbUid       = null;
  _syncEnabled = false;
  signOut(auth);
}

/**
 * Registra o listener de mudança de autenticação.
 * onLogin(uid, displayName, photoURL) → chamado ao logar
 * onLogout()                          → chamado ao deslogar
 */
export function fbInitAuth(onLogin, onLogout) {
  onAuthStateChanged(auth, user => {
    if (user) {
      _fbUid = user.uid;
      onLogin(user.uid, user.displayName, user.photoURL, user.email);
    } else {
      _fbUid = null;
      onLogout();
    }
  });
}

// ════════════════════════════════════════════════
// FIRESTORE — LEITURA INICIAL
// ════════════════════════════════════════════════

/**
 * Carrega os dados do usuário do Firestore uma vez.
 * onLoaded(data) → chamado com os dados remotos (ou null se não existir ainda)
 */
export async function fbLoadOnce(uid, onLoaded) {
  try {
    const ref  = doc(db, 'users', uid, 'plannit', 'data');
    const snap = await getDoc(ref);
    onLoaded(snap.exists() ? snap.data() : null);
  } catch(err) {
    console.error('fbLoadOnce error', err);
    onLoaded(null);
  }
}

// ════════════════════════════════════════════════
// FIRESTORE — ESCRITA (debounced)
// ════════════════════════════════════════════════

/**
 * Agenda um upload para o Firestore com debounce de 1.5s.
 * Chamado após cada save() local — garante que escritas frequentes
 * não disparem uma chamada de rede por keystroke.
 */
export function fbScheduleSave(data) {
  if (!_fbUid || !_syncEnabled) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => _fbPush(data), 1500);
}

async function _fbPush(data) {
  if (!_fbUid) return;
  try {
    const ref = doc(db, 'users', _fbUid, 'plannit', 'data');
    await setDoc(ref, {
      days:           data.days    || {},
      backlog:        data.backlog || [],
      metas:          data.metas   || [],
      _schemaVersion: 2,
      _savedAt:       new Date().toISOString()
    });
    _notifySyncStatus('ok');
  } catch(err) {
    console.error('fbPush error', err);
    _notifySyncStatus('error');
  }
}

/** Ativa o sync (chamado após carregar dados iniciais) */
export function fbEnableSync() {
  _syncEnabled = true;
}

// ════════════════════════════════════════════════
// STATUS VISUAL
// ════════════════════════════════════════════════

function _notifySyncStatus(status) {
  // Dispara evento customizado que o app.js escuta
  window.dispatchEvent(new CustomEvent('fbSyncStatus', { detail: status }));
}

export function fbGetUid()       { return _fbUid; }
export function fbIsSyncEnabled(){ return _syncEnabled; }
