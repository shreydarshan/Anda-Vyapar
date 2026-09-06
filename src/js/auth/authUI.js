/* ============================================================
   AUTH UI
   Login is OPTIONAL. The app boots straight into Billing for
   everyone (guest or returning user) — see app/init.js. This
   module only controls the small Login/Sign Up modal and the
   header account controls.
   ============================================================ */
// Password visibility toggle (spec section 15). type="button" on the
// markup side already guarantees this can never submit the form; the
// only job here is flipping the input's type and the button's icon/
// aria-label, and restoring the caret position so toggling mid-typing
// doesn't jump the cursor to the end.
function togglePwVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const hidden = input.type === 'password';
  const pos = (input.selectionStart != null) ? input.selectionStart : null;
  input.type = hidden ? 'text' : 'password';
  btn.textContent = hidden ? '🙈' : '👁';
  btn.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
  if (pos != null && input.setSelectionRange) {
    try { input.focus(); input.setSelectionRange(pos, pos); } catch (e) {}
  }
}

function openAuthModal(mode) {
  document.getElementById('auth-modal-bg').style.display = 'flex';
  document.getElementById('login-form').style.display = mode === 'signup' ? 'none' : 'block';
  document.getElementById('signup-form').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('guest-data-notice').style.display = 'none';
  hideAuthError();
  // Never carry a previous session's (or anyone's autofilled)
  // credentials into a freshly opened login/signup form — explicit
  // clear on every open, on top of autocomplete="off"/"new-password"
  // in the HTML which discourages the browser from offering to
  // refill them in the first place.
  ['login-email', 'login-password', 'signup-name', 'signup-email', 'signup-password', 'signup-confirm']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  // Reset any password field back to hidden (default state) each time
  // the modal opens, so a toggle left "visible" from a previous visit
  // never carries over.
  document.querySelectorAll('.pw-field input[type="text"]').forEach(inp => { inp.type = 'password'; });
  document.querySelectorAll('.pw-toggle').forEach(b => { b.textContent = '👁'; b.setAttribute('aria-label', 'Show password'); });
  // Auto-focus (spec section 8): first field of whichever form is visible.
  const first = document.getElementById(mode === 'signup' ? 'signup-name' : 'login-email');
  if (first) first.focus();
}
function closeAuthModal() {
  document.getElementById('auth-modal-bg').style.display = 'none';
}
function switchToSignup() { openAuthModal('signup'); }
function switchToLogin() { openAuthModal('login'); }

function hideAuthError() {
  ['login-error', 'signup-error'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('show'); el.textContent = ''; }
  });
}
function showAuthError(id, err) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = (err && err.message) ? err.message : String(err || 'Something went wrong');
  el.classList.add('show');
}

async function handleLoginSubmit(ev) {
  ev.preventDefault();
  hideAuthError();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-submit-btn');
  if (!email || !password) { showAuthError('login-error', 'Enter email and password'); return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    await AuthService.signIn(email, password);
    const pending = await onLoggedIn();
    if (!pending) closeAuthModal();
  } catch (err) {
    showAuthError('login-error', err);
  } finally {
    btn.disabled = false; btn.textContent = 'Login';
  }
}

async function handleSignupSubmit(ev) {
  ev.preventDefault();
  hideAuthError();
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const confirm = document.getElementById('signup-confirm').value;
  const btn = document.getElementById('signup-submit-btn');
  if (!email || !password) { showAuthError('signup-error', 'Enter email and password'); return; }
  if (password.length < 6) { showAuthError('signup-error', 'Password must be at least 6 characters'); return; }
  if (password !== confirm) { showAuthError('signup-error', 'Passwords do not match'); return; }
  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const data = await AuthService.signUp(email, password, name);
    // Duplicate-email detection (spec section 14): Supabase's signUp()
    // does NOT throw an error for an email that's already registered —
    // by design, to avoid leaking which emails exist. Instead, for an
    // existing account it returns a user object with an EMPTY
    // identities array (a real, documented Supabase Auth signal — see
    // supabase.com/docs/reference/javascript/auth-signup) and no new
    // session. A brand-new signup always has at least one identity.
    // This uses that actual signal rather than guessing from timing or
    // any other heuristic.
    const isDuplicate = data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0 && !data.session;
    if (isDuplicate) {
      showAuthError('signup-error', { message: lang === 'hi'
        ? 'इस ईमेल से पहले से खाता मौजूद है। कृपया लॉगिन करें।'
        : 'An account already exists with this email. Please log in instead.' });
      switchToLogin();
      return;
    }
    if (data.session) {
      const pending = await onLoggedIn();
      if (!pending) closeAuthModal();
    } else {
      showAuthError('signup-error', { message: 'Account created. Check your email to confirm, then log in.' });
      switchToLogin();
    }
  } catch (err) {
    // Some Supabase project configurations (email confirmations OFF)
    // DO throw a real error for a duplicate email instead of the
    // empty-identities signal above — handle both paths the same way.
    const msg = (err && err.message) ? err.message.toLowerCase() : '';
    if (msg.indexOf('already registered') !== -1 || msg.indexOf('already exists') !== -1 || msg.indexOf('user already') !== -1) {
      showAuthError('signup-error', { message: lang === 'hi'
        ? 'इस ईमेल से पहले से खाता मौजूद है। कृपया लॉगिन करें।'
        : 'An account already exists with this email. Please log in instead.' });
      switchToLogin();
    } else {
      showAuthError('signup-error', err);
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

// Loads the given account's data into every screen. Shared by an
// explicit login, logout-to-guest, and resuming a previously-restored
// session — those are the only three moments the active workspace is
// allowed to change.
// Only one workspace switch may ever be in flight at a time. Without
// this, an impatient double-click (e.g. Logout, then immediately
// Login again before the first switch's awaits have resolved) could
// start a SECOND enterAccountWorkspace() call while the first is
// still mid-flight — both manipulating currentAccountKey and firing
// a dozen render calls each, interleaved. That's a genuine re-entrant
// state-transition bug, not just a slow operation: the two switches'
// renders and IPC calls could land in any order, leaving the UI
// showing a mix of both attempts. A later call while one is already
// running now simply awaits the SAME in-flight switch instead of
// starting a competing one.
let _workspaceSwitchPromise = null;
async function enterAccountWorkspace(key) {
  if (_workspaceSwitchPromise) {
    await _workspaceSwitchPromise;
    if (AccountStore.currentKey() === key) return; // the in-flight switch already got us where this call wanted to go
  }
  const run = (async () => {
    await AccountStore.switchTo(key);
    applyLang(); restoreRates(); restoreShop(); restoreSettings();
    refreshUdharDatalist(); refreshCpDatalist();
    updUdharCount(); renderStock(); renderStockLog();
    renderHist(); renderUdhar(); renderReport(); renderCustPage();
    if (typeof cleanupInvalidOrders === 'function') cleanupInvalidOrders();
    document.getElementById('order-count').textContent = orders.length;
  })();
  _workspaceSwitchPromise = run;
  try { await run; } finally { if (_workspaceSwitchPromise === run) _workspaceSwitchPromise = null; }
}

async function handleLogout() {
  if (!(await showConfirm(lang === 'hi' ? 'लॉगआउट करें?' : 'Log out?'))) return;
  // Set BEFORE anything async below — this is what makes the local
  // logout authoritative even if a late Supabase event (e.g. an
  // in-flight token refresh that resolves right after signOut()'s
  // bounded timeout) arrives afterward. See finishAuthWiring()'s
  // onChange handler, which checks this flag first thing.
  _justLoggedOut = true;
  if (typeof SyncService !== 'undefined') SyncService.stopBackgroundSync();
  await AuthService.signOut();
  await enterAccountWorkspace('guest'); // local data stays on disk untouched, just switch context
  updateAccountUI();
  setSyncStatus('unconfigured');
  toast(lang === 'hi' ? 'लोकल मोड में वापस' : 'Back to Local Mode', 'ti');
  // Cleared after a short window rather than immediately — a stale
  // in-flight network response from the signOut() attempt (or a
  // trailing token-refresh) can still land a moment after this
  // function returns; this covers that without needing to guess an
  // exact duration tied to any particular timeout elsewhere.
  setTimeout(() => { _justLoggedOut = false; }, 6000);
}

// Called after a fresh login/signup succeeds this session.
// Returns true if a guest-data import decision is now pending
// (caller should keep the auth modal open in that case).
async function onLoggedIn() {
  _justLoggedOut = false; // an explicit new login always supersedes a recent logout
  const user = AuthService.getUser();
  await enterAccountWorkspace(user.id);   // load (or create) this user's isolated local data
  updateAccountUI();
  if (typeof SyncService !== 'undefined') SyncService.startBackgroundSync();
  if (typeof LegacyMigration !== 'undefined') return await LegacyMigration.checkForGuestData();
  return false;
}

// A Supabase session was found restored from a previous run, but per
// spec the app must never auto-enter that account on startup — it
// only offers to. This is what actually enters it, when the user
// explicitly clicks "Continue as <email>".
async function resumeSession() {
  const user = window._resumableUser;
  if (!user) return;
  window._resumableUser = null;
  await enterAccountWorkspace(user.id);
  updateAccountUI();
  if (typeof SyncService !== 'undefined') SyncService.startBackgroundSync();
  if (typeof LegacyMigration !== 'undefined') await LegacyMigration.checkForGuestData();
}

// "Not you?" on the resume prompt — fully detaches the restored
// session (not just hides the prompt) so it doesn't keep coming back,
// and leaves the app in ordinary Local Mode with normal Login/Sign Up.
async function discardResumableSession() {
  window._resumableUser = null;
  await AuthService.signOut();
  updateAccountUI();
  setSyncStatus('unconfigured');
}

function updateAccountUI() {
  const user = AuthService.isConfigured ? AuthService.getUser() : null;
  const guestCtrls = document.getElementById('guest-controls');
  const acctCtrls = document.getElementById('account-controls');
  const resumeCtrls = document.getElementById('resume-controls');
  const badge = document.getElementById('auth-user-badge-hdr');
  const badgeSettings = document.getElementById('auth-user-badge');
  const logoutBtn = document.getElementById('settings-logout-btn');
  const loginBtn = document.getElementById('settings-login-btn');
  const deleteCloudSection = document.getElementById('delete-cloud-section');
  const resumable = window._resumableUser;
  // The critical check is workspaceReady, not just `user`. A Supabase
  // SESSION existing (AuthService.getUser() truthy) and the DATA
  // WORKSPACE actually having switched to that account
  // (AccountStore.currentKey() === user.id) are two different things
  // that used to be conflated here — restoreOfflineSession() makes
  // `user` truthy the moment a saved session is found, well before
  // enterAccountWorkspace() has actually loaded and rendered that
  // account's data. This function used to key entirely off `user`,
  // so the header could — and did — show "Synced as X" while every
  // panel underneath was still showing whatever was loaded before
  // (Local Mode's guest data at boot, or a previous account's data
  // mid-switch). That mismatch is exactly what looked like "Local
  // Mode and Account A's data mixing" — the data was never actually
  // mixed, the header was just lying about which workspace was live.
  const workspaceReady = user && AccountStore.currentKey() === user.id;
  if (workspaceReady) {
    guestCtrls.style.display = 'none';
    if (resumeCtrls) resumeCtrls.style.display = 'none';
    acctCtrls.style.display = 'flex';
    if (badge) badge.textContent = user.email || 'Signed in';
    if (badgeSettings) badgeSettings.textContent = user.email || 'Signed in';
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    if (loginBtn) loginBtn.style.display = 'none';
    if (deleteCloudSection) deleteCloudSection.style.display = 'block';
  } else if ((resumable || (user && AccountStore.currentKey() !== user.id)) && resumeCtrls) {
    // Local Mode's workspace is what's actually loaded and rendered
    // right now, but a session is available to resume with one click.
    // This branch also catches the moment described above — a session
    // just got restored/authenticated but enterAccountWorkspace()
    // hasn't finished yet — so the header stays honest (still Local
    // Mode) until the switch genuinely completes.
    const resumeUser = resumable || user;
    guestCtrls.style.display = 'none';
    acctCtrls.style.display = 'none';
    resumeCtrls.style.display = 'flex';
    const label = document.getElementById('resume-label');
    if (label) label.textContent = (lang === 'hi' ? 'जारी रखें: ' : 'Continue as ') + (resumeUser.email || '');
    if (badgeSettings) badgeSettings.textContent = lang === 'hi' ? 'लोकल मोड (लॉगिन नहीं)' : 'Local Mode (not logged in)';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (loginBtn) loginBtn.style.display = 'inline-flex';
    if (deleteCloudSection) deleteCloudSection.style.display = 'none';
  } else {
    guestCtrls.style.display = 'flex';
    if (resumeCtrls) resumeCtrls.style.display = 'none';
    acctCtrls.style.display = 'none';
    if (badgeSettings) badgeSettings.textContent = lang === 'hi' ? 'लोकल मोड (लॉगिन नहीं)' : 'Local Mode (not logged in)';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (deleteCloudSection) deleteCloudSection.style.display = 'none';
    if (loginBtn) loginBtn.style.display = 'inline-flex';
  }
}

// ── STARTUP SESSION RESTORE (offline-first) ─────────────────────────
// Called FIRST in boot(), before any workspace is loaded or rendered.
// This determines which workspace identity to load — it does NOT load
// or render business data itself (app/init.js does that immediately
// after, via AccountStore.switchTo(), using whatever this returns).
// That ordering is the actual fix for "startup shows the wrong
// workspace": there is no longer a moment where guest data renders
// and then gets silently replaced — the workspace identity is decided
// before the first render call.
//
// AuthService.init()/restoreOfflineSession() read the session that
// supabase-js itself already persisted to local storage — this is a
// local read, not something that requires Supabase to be reachable
// (see AuthService's own comments). Still wrapped in a bounded
// timeout as a safety net: if anything unexpected stalls here (a
// hung DNS resolution, a wedged token-refresh attempt), boot() must
// never sit waiting on it — offline-first means local billing is
// available no matter what auth/network is doing.
// Guards the auth-event race explicitly called out in the spec: after
// a local logout, a late-arriving Supabase event (an in-flight token
// refresh that happened to resolve just after signOut()'s bounded
// timeout, for example) must not be able to make the app look
// authenticated again. Set the instant Logout is chosen, cleared the
// instant a genuinely new login/signup succeeds.
let _justLoggedOut = false;

async function restoreSessionForBoot() {
  try {
    const configured = await Promise.race([
      AuthService.init().then(r => r.configured),
      new Promise(resolve => setTimeout(() => resolve(false), 3000))
    ]);
    if (!configured) return null;
    await Promise.race([
      AuthService.restoreOfflineSession(),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
    return AuthService.getUser();
  } catch (e) {
    console.error('[Boot] session restore failed — continuing as guest:', e);
    return null;
  }
}

// ── REST OF AUTH WIRING (after the correct workspace has rendered) ──
// Form submit listeners, the live auth-change listener, and starting
// background sync — none of this needs to happen before billing is
// visible, so it stays here, after boot()'s render pass, exactly like
// before. The only thing that moved earlier is session restoration
// itself (see restoreSessionForBoot() above).
async function finishAuthWiring(user) {
  document.getElementById('login-form').addEventListener('submit', handleLoginSubmit);
  document.getElementById('signup-form').addEventListener('submit', handleSignupSubmit);

  if (!AuthService.isConfigured()) { setSyncStatus('unconfigured'); return; }

  if (user && navigator.onLine) {
    if (typeof SyncService !== 'undefined') SyncService.startBackgroundSync();
    if (typeof LegacyMigration !== 'undefined') await LegacyMigration.checkForGuestData();
  } else if (!user) {
    setSyncStatus('unconfigured');
  }
  // If offline with a restored user, leave sync status as whatever
  // the offline/online listeners already set (see syncService.js) —
  // billing itself is already fully usable at this point regardless.

  AuthService.onChange((u) => {
    // A real-time auth change (token refresh failing, a sign-out
    // event arriving late, etc.) — this must only ever update the
    // status DISPLAY. It must never itself switch the active
    // workspace; the active workspace is controlled exclusively by
    // AccountStore.currentKey(), set only by an explicit
    // login/logout/switch action, never by a background auth
    // callback. This is what stops a delayed event from undoing a
    // workspace transition that already happened.
    if (_justLoggedOut) return; // an explicit local logout just happened; ignore late events entirely
    updateAccountUI();
    if (!u && AccountStore.currentKey() !== 'guest') setSyncStatus('unconfigured');
  });
}
