/* ============================================================
   AUTH SERVICE
   Real Supabase Auth (email/password) via the vendored supabase-js
   SDK (src/js/vendor/supabase-js.umd.js — bundled locally so the
   app never depends on a CDN at runtime).

   IMPORTANT DISTINCTION (spec section 8):
     "Who is this user?"           -> handled here (Auth)
     "What data is on this device?" -> handled by localStore.js
   These are independent. A missing/paused Supabase project must
   never block an already-authenticated user from billing.
   ============================================================ */
const AuthService = (function () {
  let client = null;
  let currentUser = null;

  // Bounded-timeout wrapper for signIn()/signUp() (spec: "AuthService.
  // signIn() must never be allowed to leave the login UI stuck
  // indefinitely"). supabase-js's underlying fetch() call has no
  // timeout of its own — confirmed by reading the vendored SDK
  // (src/js/vendor/supabase-js.umd.js): the token request goes
  // through a plain `fetch()` with no AbortController deadline
  // anywhere in that path. A network condition that never resolves
  // (not even with an error — a silently dropped connection, a
  // hanging proxy) would leave `await client.auth.signInWithPassword()`
  // pending forever, matching the same "stuck login button" class of
  // bug independently of the confirm() dialog fix elsewhere. This
  // mirrors the pattern signOut() already used (Promise.race against
  // a timer) rather than inventing a new mechanism.
  const AUTH_TIMEOUT_MS = 12000;
  function _withTimeout(promise, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        lang === 'hi'
          ? 'अनुरोध में बहुत समय लग रहा है — कृपया अपना नेटवर्क जांचें और फिर कोशिश करें।'
          : (label || 'Request') + ' timed out — check your connection and try again.'
      )), AUTH_TIMEOUT_MS))
    ]);
  }
  let currentSession = null;
  const listeners = [];

  function notify() { listeners.forEach(fn => { try { fn(currentUser, currentSession); } catch (e) {} }); }
  function onChange(fn) { listeners.push(fn); }

  async function init() {
    const cfg = await AndaConfig.load();
    if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
      console.warn('[Auth] Supabase not configured — running local-only. Add SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY.');
      return { configured: false };
    }
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
      auth: {
        persistSession: true,     // supabase-js persists the session in localStorage itself
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });

    client.auth.onAuthStateChange((_event, session) => {
      currentSession = session;
      currentUser = session ? session.user : null;
      notify();
    });

    const { data } = await client.auth.getSession();
    currentSession = data.session;
    currentUser = data.session ? data.session.user : null;
    return { configured: true };
  }

  function isConfigured() { return !!client; }
  function getUser() { return currentUser; }
  function getSession() { return currentSession; }
  function getClient() { return client; }
  function isAuthenticated() { return !!currentUser; }

  async function signUp(email, password, name) {
    if (!client) throw new Error(_notConfiguredMessage());
    const { data, error } = await _withTimeout(client.auth.signUp({
      email, password,
      options: { data: name ? { full_name: name } : undefined }
    }), 'Account creation');
    if (error) throw error;
    return data;
  }

  // Distinguishes "there is no Supabase client at all" (this build/
  // environment was never given credentials — happens instantly, has
  // nothing to do with internet) from an actual network failure once
  // a real signIn()/signUp() attempt is made against a configured
  // client (which surfaces as a normal thrown/Supabase error instead,
  // handled separately by the caller). The old message ("needs an
  // internet connection") was wrong for the former case and actively
  // misled anyone opening this file directly in a browser instead of
  // through the Electron app, where no config is ever injected.
  function _notConfiguredMessage() {
    return navigator.onLine === false
      ? 'Sign-in needs an internet connection.'
      : 'Cloud sign-in isn\'t available in this environment (no Supabase configuration was found) — this happens when the app is opened as a plain HTML file instead of run through the Electron app or desktop build. Local billing still works fully offline.';
  }

  async function signIn(email, password) {
    if (!client) throw new Error(_notConfiguredMessage());
    const { data, error } = await _withTimeout(client.auth.signInWithPassword({ email, password }), 'Sign-in');
    if (error) throw error;
    currentSession = data.session;
    currentUser = data.user;
    return data;
  }

  async function signOut() {
    // client.auth.signOut() is a real network call (it invalidates the
    // session server-side) with no timeout of its own. If Supabase is
    // slow, unreachable, or paused (a documented real possibility for
    // this project's free-tier plan — see README), this used to make
    // Logout hang indefinitely on that network round-trip before ever
    // reaching the local workspace switch below it — the app would
    // sit there looking stuck for however long the network attempt
    // took, exactly matching "unresponsive after logout". Logging out
    // locally must never depend on Supabase actually being reachable;
    // bounded here so it always proceeds to the local state change
    // within a few seconds regardless of network conditions.
    if (client) {
      try {
        await Promise.race([
          client.auth.signOut(),
          new Promise((resolve) => setTimeout(resolve, 4000))
        ]);
      } catch (e) {}
    }
    currentUser = null;
    currentSession = null;
    notify();
  }

  async function resetPassword(email) {
    if (!client) throw new Error(_notConfiguredMessage());
    const { error } = await client.auth.resetPasswordForEmail(email);
    if (error) throw error;
  }

  // Called on startup. If we have a cached session (from supabase-js's own
  // persistence) we treat the user as authenticated for OFFLINE BILLING
  // purposes even if the network/Supabase project is unreachable right now.
  // Token refresh happens silently in the background whenever online.
  async function restoreOfflineSession() {
    if (!client) return null;
    try {
      const { data } = await client.auth.getSession();
      if (data.session) {
        currentSession = data.session;
        currentUser = data.session.user;
      }
    } catch (e) {
      // Supabase unreachable — fall back to whatever supabase-js already
      // cached locally (it reads its own localStorage synchronously
      // internally), so this is not a hard failure.
    }
    return currentUser;
  }

  return {
    init, isConfigured, isAuthenticated,
    getUser, getSession, getClient,
    signUp, signIn, signOut, resetPassword,
    restoreOfflineSession, onChange
  };
})();
