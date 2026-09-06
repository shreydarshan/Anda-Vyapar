const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises; // async variants for the hot-path save/load handlers below
const os   = require('os');
const { Worker } = require('worker_threads');

// ── FIX: renderer freezes (keyboard + mouse both unresponsive) until
// the window is minimized and restored ──────────────────────────────
// This is a well-documented Chromium/Electron bug on Windows: Chromium's
// "native window occlusion" tracking periodically checks whether the
// window is actually visible, and on some Windows/GPU-driver
// combinations it incorrectly decides the window is occluded (hidden
// behind something) even while it's the focused, visible, foreground
// window — at which point Chromium throttles/pauses the renderer as an
// optimization for genuinely-hidden windows. Minimizing and restoring
// forces a fresh occlusion check that clears the incorrect state,
// which is exactly the "have to minimize then reopen" workaround
// being described. Must be set before app.whenReady() — Chromium
// command-line switches can't be changed once the engine has started.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// ── ENV / CONFIG ─────────────────────────────────────────────────────────────
// Supabase URL + publishable key come from a local .env file that is
// NEVER committed to source control (see .gitignore). Only the public
// publishable key is ever handled this way — it is safe for the client
// because Supabase Row Level Security enforces per-user access, not
// the key itself. This project uses Supabase's current Publishable
// Key format (starts with sb_publishable_), not the legacy anon JWT.
// See .env.example for the expected format.
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  const env = {};
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    });
  } catch (e) {
    // No .env file present — app still runs, just local-only (see config.js).
  }
  return env;
}
const ENV = loadEnvFile();

// ── DATA FOLDER ───────────────────────────────────────────────────────────────
// Automatically created in Documents\Anda Vyapar Data on first launch
function getDataFolder() {
  const dir = path.join(os.homedir(), 'Documents', 'Anda Vyapar Data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'README.txt'),
      [
        'Anda Vyapar - Egg Business Manager',
        '====================================',
        'This folder stores ALL your business data.',
        'DO NOT delete this folder!',
        '',
        '  data.json   - All orders, udhar, rates, stock (auto-saved)',
        '  backups\\    - Daily automatic backups (last 30 days)',
        '',
        'Created: ' + new Date().toLocaleString(),
      ].join('\r\n'),
      'utf8'
    );
  }
  return dir;
}

const DATA_FOLDER = getDataFolder();
const ACCOUNTS_DIR = path.join(DATA_FOLDER, 'accounts');
const BACKUP_DIR  = path.join(DATA_FOLDER, 'backups');

// ── LEGACY DATA MIGRATION (pre-account-scoping versions) ──────────────────
// Older builds wrote straight to Documents\Anda Vyapar Data\data.json.
// If that file exists and no guest account file exists yet, move it into
// the new accounts/guest/ location so existing business data is never lost.
(function migrateLegacyDataFile() {
  const legacyFile = path.join(DATA_FOLDER, 'data.json');
  const guestDir = path.join(ACCOUNTS_DIR, 'guest');
  const guestFile = path.join(guestDir, 'data.json');
  if (fs.existsSync(legacyFile) && !fs.existsSync(guestFile)) {
    fs.mkdirSync(guestDir, { recursive: true });
    fs.copyFileSync(legacyFile, guestFile);
    // Keep the old file in place too (harmless, and a safety net) rather
    // than deleting real business data as part of a silent migration.
  }
})();

// ── ACCOUNT-SCOPED DATA FILES ─────────────────────────────────────────────
// Guest data and each authenticated user's data live in fully separate
// files, so switching accounts on the same machine can never mix them.
// Account keys come from the renderer ('guest' or a Supabase user id) —
// sanitize before touching the filesystem.
function sanitizeAccountKey(key) {
  const k = String(key || 'guest').replace(/[^a-zA-Z0-9_-]/g, '');
  return k || 'guest';
}
function dataFileFor(accountKey) {
  const dir = path.join(ACCOUNTS_DIR, sanitizeAccountKey(accountKey));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'data.json');
}

// ── DAILY BACKUP ──────────────────────────────────────────────────────────────
function doDailyBackup() {
  if (!fs.existsSync(ACCOUNTS_DIR)) return;
  // Same local-date fix as av-export above — .toISOString() would use
  // UTC and could file today's backup under yesterday's date (or skip
  // running at all on the actual local day) for timezones ahead of UTC.
  const _now = new Date();
  const today = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0') + '-' + String(_now.getDate()).padStart(2, '0');
  const accountDirs = fs.readdirSync(ACCOUNTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
  accountDirs.forEach(({ name: accountKey }) => {
    const dataFile = path.join(ACCOUNTS_DIR, accountKey, 'data.json');
    if (!fs.existsSync(dataFile)) return;
    const acctBackupDir = path.join(BACKUP_DIR, accountKey);
    if (!fs.existsSync(acctBackupDir)) fs.mkdirSync(acctBackupDir, { recursive: true });
    const dest = path.join(acctBackupDir, `data-backup-${today}.json`);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(dataFile, dest);
      const files = fs.readdirSync(acctBackupDir).filter(f => f.startsWith('data-backup-')).sort();
      while (files.length > 30) {
        try { fs.unlinkSync(path.join(acctBackupDir, files.shift())); } catch(e) {}
      }
    }
  });
}

// ── IPC HANDLERS ─────────────────────────────────────────────────────────────
// Called from renderer via preload.js bridge

// Public runtime config (Supabase URL + publishable key only)
ipcMain.handle('av-config', () => ({
  supabaseUrl: ENV.SUPABASE_URL || '',
  supabasePublishableKey: ENV.SUPABASE_PUBLISHABLE_KEY || ''
}));

// Load all data from disk (account-scoped). Async — fs.readFileSync
// here would block Electron's single-threaded main process for the
// duration of the disk read + JSON.parse, and the main process is
// also what routes native window/input messages on Windows. A large
// account file blocking that thread is a real, direct freeze risk on
// every account load/switch, not just a theoretical one.
ipcMain.handle('av-load', async (event, accountKey) => {
  try {
    const file = dataFileFor(accountKey);
    if (fs.existsSync(file)) { // existsSync is a cheap stat, not the expensive part — left sync for simplicity
      const raw = await fsp.readFile(file, 'utf8');
      return { ok: true, data: JSON.parse(raw), folder: path.dirname(file) };
    }
    return { ok: true, data: null, folder: path.dirname(file) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Save all data to disk (account-scoped). Async for the same reason —
// this is the actual hot path: it fires on every debounced local save
// (every business action, and every ~400ms of active typing in any
// autosaved field), and JSON.stringify + write of a large account
// file (thousands of orders) synchronously on the main process was a
// real, confirmed freeze contributor, independent of the renderer-side
// debouncing — the renderer being well-behaved doesn't help if the
// main process itself blocks once the write actually happens.
// Runs JSON.stringify + the file write on a separate worker thread
// (see saveWorker.js doc comment for why) instead of on the main
// process. Bounded timeout so a stuck/crashed worker can never hang
// a save indefinitely — same "no infinite wait" principle used
// throughout this app's sync layer. terminate() is called in every
// exit path (success, error, timeout) so a worker can never linger.
function saveViaWorker(filePath, payload) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(path.join(__dirname, 'saveWorker.js'), { workerData: { filePath, payload } });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error('Save timed out'));
    }, 15000);
    worker.once('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      msg && msg.ok ? resolve() : reject(new Error((msg && msg.error) || 'Save worker failed'));
    });
    worker.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      reject(err);
    });
  });
}

ipcMain.handle('av-save', async (event, payload, accountKey) => {
  try {
    await saveViaWorker(dataFileFor(accountKey), payload);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Get the data folder path for this account
ipcMain.handle('av-folder', (event, accountKey) => path.dirname(dataFileFor(accountKey)));

// Open data folder in Windows Explorer (account-scoped)
ipcMain.handle('av-open-folder', (event, accountKey) => {
  shell.openPath(path.dirname(dataFileFor(accountKey)));
  return true;
});

// Export backup - native Save dialog
ipcMain.handle('av-export', async (event, payload) => {
  // Same local-date fix as the renderer's localIsoDate() (see
  // src/js/utils/format.js) — this runs in the main process, a
  // separate JS context, so it needs its own copy rather than a
  // shared import. .toISOString() converts to UTC, which would name
  // the file with the wrong calendar day for any timezone ahead of
  // UTC during the day's early hours.
  const _now = new Date();
  const _localDate = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0') + '-' + String(_now.getDate()).padStart(2, '0');
  const { filePath } = await dialog.showSaveDialog({
    title: 'Export Anda Vyapar Backup',
    defaultPath: path.join(
      os.homedir(), 'Desktop',
      `anda-vyapar-backup-${_localDate}.json`
    ),
    filters: [{ name: 'JSON Backup', extensions: ['json'] }]
  });
  if (!filePath) return { ok: false, cancelled: true };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, filePath };
});

// Import backup - native Open dialog
ipcMain.handle('av-import', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    title: 'Import Anda Vyapar Backup',
    filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (!filePaths || !filePaths[0]) return { ok: false, cancelled: true };
  try {
    const raw = fs.readFileSync(filePaths[0], 'utf8');
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── PRINTING (native Electron pipeline — spec section 24) ────────────────────
// List installed printers so Settings can offer a dropdown instead of a
// hardcoded device name (Windows driver names vary machine to machine).
// Lists installed printers, preserving the OS-reported status field
// (Windows: PrinterInfo.status, 0 = idle/ready; other values indicate
// offline/error/paused/etc). Without this, the renderer's readiness
// check (printerSettings.js) has nothing but "installed" to go on,
// which is NOT the same as "ready" — see PrinterSettings.isReady().
ipcMain.handle('av-get-printers', async () => {
  try {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map(p => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: !!p.isDefault,
      status: typeof p.status === 'number' ? p.status : null
    }));
  } catch (e) {
    return [];
  }
});

// Render the receipt HTML in a hidden offscreen window and send it straight
// to the selected thermal printer — no visible browser window, no print
// dialog, no Chrome zoom/scaling tricks. `printerName` is optional; when
// omitted, Electron uses the OS default printer.
ipcMain.handle('av-print-receipt', async (event, html, printerName, showDialog) => {
  return new Promise((resolve) => {
    const printWin = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: false, contextIsolation: true, nodeIntegration: false }
    });
    printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    printWin.webContents.on('did-finish-load', async () => {
      // Explicit zero margins on all four sides, rather than the vaguer
      // marginType:'none' — this is the one thing we can make fully
      // deterministic on the Chromium/Electron side. Anything beyond
      // this (a driver-level horizontal offset baked into the H80i's
      // own Windows print preferences) is outside what any web content
      // or Electron print call can see or override — see README.
      const opts = {
        silent: !showDialog,
        printBackground: true,
        margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 }
      };
      // Explicit content-driven pageSize (spec section 8 / V12 item 8):
      // relying on the page's CSS `@page{size:${pw}mm auto}` alone was
      // not actually verified against a real printer driver — Chromium
      // negotiates paper size with whatever the Windows print driver
      // reports as available media, and many thermal-printer drivers
      // only expose fixed preset heights rather than honoring CSS
      // "auto" height, which is exactly how a receipt ends up with a
      // long blank tail on real paper even though the on-screen HTML
      // looks correctly sized. Measuring the actual rendered content
      // height in THIS SAME window (the one about to print, so the
      // measurement can never mismatch what's sent to the printer) and
      // passing it as an explicit pageSize is the standard, reliable
      // way around driver-level "auto" support being inconsistent.
      try {
        const contentPx = await printWin.webContents.executeJavaScript('document.body.scrollHeight');
        const widthMatch = html.match(/html,body\{[^}]*width:([\d.]+)mm/);
        const widthMm = widthMatch ? parseFloat(widthMatch[1]) : 80;
        // CSS mm is defined as 96px/inch ÷ 25.4mm/inch — converting the
        // measured pixel height back to physical mm this way keeps it
        // consistent with the `width:${pw}mm` the receipt was actually
        // laid out at, regardless of this window's device scale factor.
        const contentMm = (typeof contentPx === 'number' && contentPx > 0) ? (contentPx * 25.4 / 96) : 150;
        const heightMm = Math.min(1500, Math.max(30, contentMm + 5)); // +5mm safety margin; sane bounds against a bad measurement
        opts.pageSize = { width: Math.round(widthMm * 1000), height: Math.round(heightMm * 1000) }; // Electron expects microns
      } catch (e) {
        // Measurement failed for any reason — fall back to letting
        // Chromium/the driver decide, exactly like before this fix,
        // rather than failing the print entirely over a cosmetic issue.
      }
      // deviceName only makes sense as a forced target for SILENT
      // printing. When the user asked for the native dialog, they get
      // to pick/confirm the printer there — passing deviceName too
      // would just pre-select it, which Chromium already does when a
      // default exists, so this is deliberately only set in the
      // silent path.
      if (printerName && !showDialog) opts.deviceName = printerName;
      printWin.webContents.print(opts, (success, reason) => {
        printWin.close();
        if (success) resolve({ ok: true });
        else resolve({ ok: false, error: reason || 'Print failed', cancelled: reason === 'cancelled' });
      });
    });
    printWin.webContents.on('did-fail-load', () => {
      printWin.close();
      resolve({ ok: false, error: 'Failed to render receipt' });
    });
  });
});

// ── WINDOW ────────────────────────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  doDailyBackup();

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Anda Vyapar — Egg Business Manager',
    icon: path.join(__dirname, '..', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,      // Must be false for security
      contextIsolation: true,      // Must be true - preload bridge works
      preload: path.join(__dirname, 'preload.js')
    },
    show: false,                   // Don't show until ready (no white flash)
    backgroundColor: '#FDF8F0'
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  // Show window once fully loaded
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Open external links in browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ── FLUSH PENDING SAVE BEFORE CLOSING ────────────────────────────────
  // The renderer debounces disk writes (localStore.js `sv()`, 400ms) so
  // it doesn't hammer the disk on every keystroke. Without this, closing
  // the window inside that 400ms window (e.g. right after Reset
  // Everything, or right after placing an order) would quit the app
  // before the write ever happens, silently reviving the old on-disk
  // data on next launch. Intercept the close once, ask the renderer to
  // flush synchronously, then let the close proceed for real. A short
  // timeout is a safety net only — it must never be able to make the
  // app un-closable if the renderer is unresponsive.
  let flushDone = false;
  mainWindow.on('close', (e) => {
    if (flushDone) return; // second, real close after flush completed — let it through
    e.preventDefault();
    mainWindow.webContents.send('av-flush-before-close');
    const proceed = () => {
      if (flushDone) return;
      flushDone = true;
      if (mainWindow) mainWindow.close();
    };
    ipcMain.once('av-flush-done', proceed);
    setTimeout(proceed, 1500); // safety net if renderer never acks
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
