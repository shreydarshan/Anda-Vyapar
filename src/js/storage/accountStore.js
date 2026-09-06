/* ============================================================
   ACCOUNT STORE
   Owns the "which account's local data is currently loaded"
   concern. Guest data and each user's data live in completely
   separate local files/localStorage buckets (see localStore.js's
   `currentAccountKey`-scoped keys and electron/main.js's
   accounts/<key>/data.json layout).
   ============================================================ */
const AccountStore = (function () {
  function currentKey() { return currentAccountKey; }

  // Human-readable label for whichever account is currently active —
  // shared by the reset confirmation and (below) the backup-import
  // cross-account warning, so both describe "who you are right now"
  // the same way instead of two separate copies of this logic drifting
  // apart over time.
  function currentLabel() {
    if (currentAccountKey === 'guest') return lang === 'hi' ? 'गेस्ट (लोकल)' : 'Guest (local)';
    return (typeof AuthService !== 'undefined' && AuthService.getUser()) ? AuthService.getUser().email : currentAccountKey;
  }

  // Switches the active local data context and loads it. If the
  // target account has NO local data yet (e.g. first login on a new
  // device) and Supabase is reachable, attempts a one-time cloud
  // restore so the user isn't starting from zero on a new machine.
  async function switchTo(key) {
    // Flush any save still waiting on the debounce timer for the
    // CURRENT account before we flip currentAccountKey. Without this,
    // a pending write scheduled while still on the old account could
    // fire after the key below has already changed and — since it's
    // keyed and payloaded at call time now (see localStore.js) — it's
    // no longer misdirected, but it could still race with `ld()`
    // below and get overwritten pointlessly. Flushing first keeps the
    // sequence strictly: finish writing the old account -> switch key
    // -> load the new account. No window where the two can interleave.
    if (typeof flushPendingSave === 'function') await flushPendingSave();
    currentAccountKey = key;
    const found = await ld();
    if (!found && key !== 'guest' && typeof SyncService !== 'undefined' && SyncService.isReachable()) {
      try {
        const restored = await SyncService.pullAll();
        if (restored) { sv(); toast(lang === 'hi' ? 'क्लाउड से डेटा वापस मिला' : 'Restored your data from the cloud', 'ts'); }
      } catch (e) {
        // No local data AND cloud unreachable/empty — start fresh locally.
        // This is fine; it's exactly the "new account, no data yet" case.
      }
    }
    return found;
  }

  return { currentKey, currentLabel, switchTo };
})();
