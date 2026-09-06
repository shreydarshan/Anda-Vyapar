/* ============================================================
   SAVE WORKER
   ------------------------------------------------------------
   Root-cause fix (V22 stability pass, item 2): JSON.stringify() of
   the full local dataset ran synchronously on the Electron MAIN
   process before this, right before an already-async writeFile. For
   a very large dataset that stringify call itself could take enough
   time to delay the main process from servicing OTHER work queued on
   it at the same moment — other IPC calls, native window messages —
   for however long the stringify took. Not the same mechanism as the
   renderer input freeze (already fixed via the confirm() dialog
   removal — that one directly blocked keyboard/mouse events), but a
   real, separate way a large save could make the app feel briefly
   less responsive.

   This runs the stringify AND the write on a dedicated worker thread
   instead, so the main process's own event loop is never occupied by
   it — a genuinely separate OS-scheduled thread, not just a promise
   on the same thread. One worker is spawned per save and exits when
   done; save calls are already debounced (see localStore.js's 400ms
   debounce) and chained (see _writeInFlight), so saves are infrequent
   enough that per-save worker startup cost (a few ms) is a non-issue,
   and avoids the added complexity/failure surface of keeping a
   long-lived worker alive across the app's whole session.

   FINAL AUDIT FIX (data integrity, spec section 9): this used to call
   fs.writeFileSync() directly on the real data.json path. A crash,
   power loss, or forced app-kill DURING that write (however unlikely
   the timing) would leave data.json truncated/partially-written —
   the very next launch would then either fail to parse it or load a
   corrupted fragment, silently destroying the account's entire local
   business history with no recovery path. Writing to a temp file in
   the SAME directory (so it's on the same filesystem/volume) and then
   renaming it over the real file is the standard atomic-write
   pattern: fs.renameSync is an atomic filesystem operation on both
   Windows and POSIX, so at every instant either the OLD complete file
   or the NEW complete file exists at the real path — never a partial
   one. The previous, still-intact file is also copied to a
   `.bak` sibling right before the swap (best-effort, never blocks the
   real save on failure) as one more line of defense specifically
   against "the new write itself was bad" (e.g. a caller accidentally
   serializing a corrupted/half-updated in-memory state) — restorable
   manually from the account's data folder if that ever happens.
   ============================================================ */
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

const filePath = workerData.filePath;
const dir = path.dirname(filePath);
// Computed once, outside the try block, so the catch handler's cleanup
// always refers to the SAME temp path the try block actually used —
// recomputing it with a fresh Date.now() in catch would silently miss
// the real leftover file.
const tmpPath = path.join(dir, '.tmp-' + path.basename(filePath) + '-' + process.pid + '-' + Date.now());
const bakPath = filePath + '.bak';

try {
  const json = JSON.stringify(workerData.payload, null, 2);
  fs.writeFileSync(tmpPath, json, 'utf8');

  // Best-effort previous-version snapshot — never let this fail the
  // actual save (e.g. first-ever save for this account, no prior file).
  try {
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, bakPath);
  } catch (bakErr) { /* non-fatal — see comment above */ }

  fs.renameSync(tmpPath, filePath); // atomic swap — no partially-written data.json is ever observable
  parentPort.postMessage({ ok: true });
} catch (err) {
  // Clean up the leftover temp file so it can't accumulate across
  // repeated failures (e.g. disk full) — best-effort, ignore any
  // secondary error from the cleanup itself.
  try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (cleanupErr) { /* ignore */ }
  parentPort.postMessage({ ok: false, error: String((err && err.message) || err) });
}
