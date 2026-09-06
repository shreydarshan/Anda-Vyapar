/* ============================================================
   SYNC QUEUE
   Local save always happens first (localStore.js). This module
   just tracks "there are changes Supabase hasn't seen yet" and
   survives an app restart. It never blocks billing.
   ============================================================ */
const SyncQueue = (function () {
  // Scoped per account (guest included) — a single shared key here
  // was a real bug: Account A going offline and making a change would
  // set one global "changes waiting" flag, and if Account B (or
  // guest) later synced successfully for an unrelated reason, that
  // SAME flag got cleared — silently losing track of Account A's
  // still-actually-pending change, and showing Account B a stale
  // "changes waiting" state that was never really theirs.
  function qkey() { return 'av4_sync_dirty_since_' + currentAccountKey; }
  function vkey() { return 'av4_sync_dirty_version_' + currentAccountKey; }

  // Root-cause fix (V21 stability pass, item 4 — the dirty-flag race):
  // markDirty() used to only set a "first dirty" TIMESTAMP once, never
  // updated again while already dirty. That meant syncInBackground()
  // had no way to tell "a NEW change arrived while this push was still
  // in flight" from "nothing changed since the push started" — it just
  // unconditionally cleared the flag on any successful push. Sequence
  // that lost data from the sync's point of view:
  //   edit #1 -> markDirty() -> push starts, reads current data
  //   edit #2 arrives WHILE the push is still awaiting a batch
  //   push finishes (pushed what it read, i.e. missing edit #2)
  //   -> SyncQueue.clear() wipes the dirty flag anyway
  //   -> UI shows "Synced" even though edit #2 was never sent
  // Fix: a monotonically-incrementing version, bumped on every dirty
  // event (not just the first). The caller captures the version
  // before starting a push and only clears if it's UNCHANGED after —
  // if it advanced, something new arrived mid-sync, so the dirty
  // state is correctly left in place for the next cycle to catch it.
  function markDirty() {
    if (!localStorage.getItem(qkey())) localStorage.setItem(qkey(), String(Date.now()));
    const v = parseInt(localStorage.getItem(vkey()) || '0', 10) + 1;
    localStorage.setItem(vkey(), String(v));
    renderQueueDisplay();
  }

  function clear() {
    localStorage.removeItem(qkey());
    localStorage.removeItem(vkey());
    renderQueueDisplay();
  }

  // Only clears if no NEW markDirty() has happened since versionAtStart
  // was captured — see fix rationale above. Returns true if it cleared.
  function clearIfUnchangedSince(versionAtStart) {
    const current = parseInt(localStorage.getItem(vkey()) || '0', 10);
    if (current !== versionAtStart) { renderQueueDisplay(); return false; }
    clear();
    return true;
  }

  function isDirty() { return !!localStorage.getItem(qkey()); }
  function dirtySince() { const v = localStorage.getItem(qkey()); return v ? parseInt(v) : null; }
  function dirtyVersion() { return parseInt(localStorage.getItem(vkey()) || '0', 10); }

  return { markDirty, clear, clearIfUnchangedSince, isDirty, dirtySince, dirtyVersion };
})();

// ── SYNC STATUS UI ────────────────────────────────────────
// Explicit states only — "Synced" is never shown unless a push
// genuinely succeeded. States: 'on' (🟢 synced), 'spin' (🔄 syncing),
// 'connecting', 'waiting' (🟡 offline, changes queued), 'error'
// (🔴 online but the last sync attempt failed), 'off' (offline, no
// pending changes), 'unconfigured' (⚪ local mode / not signed in).
function setSyncStatus(state) {
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-txt');
  if (!dot || !txt) return;
  if (state === 'on') {
    dot.style.background = '#4CAF50'; dot.style.animation = '';
    txt.textContent = lang === 'hi' ? '🟢 सिंक हो गया' : '🟢 Synced';
  } else if (state === 'spin') {
    dot.style.background = '#FFC107'; dot.style.animation = 'blink .6s infinite';
    txt.textContent = lang === 'hi' ? '🔄 सिंक हो रहा है...' : '🔄 Syncing...';
  } else if (state === 'connecting') {
    dot.style.background = '#FFC107'; dot.style.animation = 'blink .6s infinite';
    txt.textContent = lang === 'hi' ? '🔄 कनेक्ट हो रहा है...' : '🔄 Connecting...';
  } else if (state === 'unconfigured') {
    dot.style.background = '#9E9E9E'; dot.style.animation = '';
    txt.textContent = lang === 'hi' ? '⚪ स्थानीय मोड' : '⚪ Local mode';
  } else if (state === 'error') {
    dot.style.background = '#f44336'; dot.style.animation = '';
    txt.textContent = lang === 'hi' ? '🔴 सिंक विफल' : '🔴 Sync failed';
  } else if (state === 'waiting') {
    dot.style.background = '#FF9800'; dot.style.animation = '';
    txt.textContent = lang === 'hi' ? '🟡 सिंक बाकी' : '🟡 Sync pending';
  } else {
    dot.style.background = SyncQueue.isDirty() ? '#FF9800' : '#9E9E9E'; dot.style.animation = '';
    txt.textContent = SyncQueue.isDirty()
      ? (lang === 'hi' ? '🟡 सिंक बाकी' : '🟡 Sync pending')
      : (lang === 'hi' ? '⚪ ऑफलाइन — स्थानीय' : '⚪ Offline — Local');
  }
  sbConnected = (state === 'on');
  updateConnStatusBadge(state);
}

function updateConnStatusBadge(state) {
  const badge = document.getElementById('conn-status-badge');
  const dot = document.getElementById('conn-dot');
  const lbl = document.getElementById('conn-label');
  if (!badge) return;
  if (state === 'on') {
    badge.style.background = 'var(--gbg)'; badge.style.borderColor = 'var(--gb)';
    dot.style.background = 'var(--grn)'; lbl.style.color = 'var(--grn)';
    lbl.textContent = lang === 'hi' ? '🟢 ऑनलाइन — सिंक हो गया' : '🟢 Online — All data synced';
  } else if (state === 'spin' || state === 'connecting') {
    badge.style.background = 'var(--ambg)'; badge.style.borderColor = '#EF9F27';
    dot.style.background = '#EF9F27'; lbl.style.color = 'var(--amb)';
    lbl.textContent = state === 'spin' ? (lang === 'hi' ? '🔄 सिंक हो रहा है...' : '🔄 Syncing...') : (lang === 'hi' ? '🔄 कनेक्ट हो रहा है...' : '🔄 Connecting...');
  } else if (state === 'unconfigured') {
    badge.style.background = 'var(--s2)'; badge.style.borderColor = 'var(--bdr)';
    dot.style.background = 'var(--t3)'; lbl.style.color = 'var(--t2)';
    lbl.textContent = lang === 'hi' ? '⚪ स्थानीय मोड — साइन इन नहीं' : '⚪ Local mode — Not signed in';
  } else if (state === 'error') {
    badge.style.background = 'var(--rbg)'; badge.style.borderColor = 'var(--rb)';
    dot.style.background = 'var(--red)'; lbl.style.color = 'var(--red)';
    lbl.textContent = lang === 'hi' ? '🔴 सिंक विफल — बाद में फिर कोशिश होगी' : '🔴 Sync failed — will retry automatically';
  } else if (state === 'waiting') {
    badge.style.background = 'var(--ambg)'; badge.style.borderColor = '#EF9F27';
    dot.style.background = '#EF9F27'; lbl.style.color = 'var(--amb)';
    lbl.textContent = lang === 'hi' ? '🟡 ऑफलाइन — बदलाव सिंक होने बाकी' : '🟡 Offline — changes waiting to sync';
  } else {
    badge.style.background = 'var(--s2)'; badge.style.borderColor = 'var(--bdr)';
    dot.style.background = SyncQueue.isDirty() ? '#EF9F27' : 'var(--t3)';
    lbl.style.color = SyncQueue.isDirty() ? 'var(--amb)' : 'var(--t2)';
    lbl.textContent = SyncQueue.isDirty()
      ? (lang === 'hi' ? '🟡 ऑफलाइन — बदलाव सिंक होने बाकी' : '🟡 Offline — changes waiting to sync')
      : (lang === 'hi' ? '⚪ ऑफलाइन — स्थानीय बिलिंग सक्रिय' : '⚪ Offline — local billing active');
  }
  const banner = document.getElementById('offline-banner');
  if (banner) {
    if (state === 'off' || state === 'waiting' || state === 'unconfigured') banner.classList.add('show');
    else banner.classList.remove('show');
  }
}

function renderQueueDisplay() {
  const lb = document.getElementById('last-backup-time');
  if (lb) lb.textContent = (typeof lastBackupTime !== 'undefined' && lastBackupTime) ? new Date(lastBackupTime).toLocaleString('en-IN') : (lang === 'hi' ? 'अभी तक नहीं' : 'Not yet');
  const el = document.getElementById('queue-list-display');
  if (!el) return;
  if (!SyncQueue.isDirty()) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const since = SyncQueue.dirtySince();
  el.innerHTML = `<div style="padding:5px 8px;background:var(--ambg);border-radius:6px;font-size:12px;color:var(--amb)">
    ${lang === 'hi' ? 'बदलाव बाकी हैं — सिंक होने का इंतज़ार' : 'Changes waiting to sync'} ${since ? '· ' + new Date(since).toLocaleTimeString('en-IN') : ''}
  </div>`;
}
