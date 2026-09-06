/* ============================================================
   CONFIG
   Supabase URL + publishable key are NOT hardcoded here.
   - Electron build: main.js reads them from a local .env file
     (never committed) and exposes them read-only via preload.js.
   - Web/browser build: index.html may set window.__ANDA_CONFIG__
     from a build-time injected <script>, also never committed.
   Only the PUBLIC publishable key (sb_publishable_...) is ever
   handled this way — it is safe to ship to the client because Row
   Level Security (RLS) enforces per-user access, not the key itself.
   This project uses Supabase's current Publishable Key format, not
   the legacy anon JWT — no anon key is expected or required.
   ============================================================ */
const AndaConfig = (function () {
  let cfg = { supabaseUrl: '', supabasePublishableKey: '', ready: false };

  async function load() {
    try {
      if (window.electronAPI && typeof window.electronAPI.getConfig === 'function') {
        const c = await window.electronAPI.getConfig();
        cfg = { supabaseUrl: c.supabaseUrl || '', supabasePublishableKey: c.supabasePublishableKey || '', ready: true };
        return cfg;
      }
    } catch (e) {
      console.warn('Config load from Electron failed:', e);
    }
    // Web fallback — set by a non-committed build-time script tag.
    if (window.__ANDA_CONFIG__) {
      cfg = {
        supabaseUrl: window.__ANDA_CONFIG__.SUPABASE_URL || '',
        supabasePublishableKey: window.__ANDA_CONFIG__.SUPABASE_PUBLISHABLE_KEY || '',
        ready: true
      };
    } else {
      cfg = { supabaseUrl: '', supabasePublishableKey: '', ready: true };
    }
    return cfg;
  }

  function get() { return cfg; }
  function isConfigured() { return !!(cfg.supabaseUrl && cfg.supabasePublishableKey); }

  return { load, get, isConfigured };
})();
