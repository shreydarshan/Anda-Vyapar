#!/usr/bin/env node
/**
 * verify-electron.js
 *
 * `electron`'s own postinstall (node_modules/electron/install.js) can
 * fail partway through — most commonly because real-time antivirus
 * intercepts/quarantines the freshly-extracted electron.exe/DLLs while
 * leaving the harmless locale data files alone — and still leave `npm
 * install` looking like it finished without error. The broken state
 * (dist/ missing the binary, node_modules/electron/path.txt never
 * written) then goes unnoticed until someone actually tries to run
 * the app.
 *
 * Root cause, verified against the real electron@28.3.3 package source:
 *   - node_modules/electron/index.js resolves the binary SOLELY from
 *     node_modules/electron/path.txt — not from whether dist/electron.exe
 *     itself exists. A missing path.txt throws even if the binary is
 *     physically present (e.g. after a manual recovery copy).
 *   - path.txt is written by install.js only as the LAST step, after a
 *     full successful zip extraction. Any interruption skips it.
 *   - A subsequent `npm install` does not reliably retry electron's
 *     postinstall if node_modules/electron is already present at the
 *     expected version — the broken state can persist across "reinstalls"
 *     unless node_modules/electron is removed completely.
 *
 * This script runs as this project's own postinstall step (after
 * electron's postinstall has had its chance to run) and checks the
 * ACTUAL, documented conditions electron's own index.js depends on.
 * If they're not met, it fails the install loudly with a clear,
 * actionable message instead of letting a broken Electron pass silently.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const pathTxt = path.join(electronDir, 'path.txt');
const distDir = path.join(electronDir, 'dist');
const distVersion = path.join(distDir, 'version');

function fail(message) {
  console.error('\n' + '='.repeat(70));
  console.error('ELECTRON INSTALL VERIFICATION FAILED');
  console.error('='.repeat(70));
  console.error(message);
  console.error('\nThis means npm reported success, but the Electron runtime binary');
  console.error('did not install correctly (see README.md "Electron install");');
  console.error('the app cannot start until this is fixed.');
  console.error('='.repeat(70) + '\n');
  process.exit(1);
}

// If the project explicitly opted out of downloading Electron at all
// (e.g. CI building for a different target), don't block on it.
if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
  console.log('[verify-electron] ELECTRON_SKIP_BINARY_DOWNLOAD is set — skipping verification.');
  process.exit(0);
}

if (!fs.existsSync(electronDir)) {
  fail('node_modules/electron does not exist at all — "npm install" did not install the electron package. Check your network connection and re-run "npm install".');
}

if (!fs.existsSync(pathTxt)) {
  fail(
    'node_modules/electron/path.txt is missing.\n' +
    'electron\'s own install.js only writes this file after a fully successful\n' +
    'binary download + extraction. Its absence means that step was interrupted\n' +
    '(a very common cause on Windows is real-time antivirus quarantining the\n' +
    'freshly-extracted electron.exe/DLLs — locale data files are unaffected,\n' +
    'which is why you may still see node_modules/electron/dist/locales/ present).\n\n' +
    'Fix: see the "Electron install" section in README.md — it is not enough to\n' +
    'delete node_modules and reinstall; the external Electron download cache\n' +
    'must also be cleared, or the retry will reproduce the same failure.'
  );
}

if (!fs.existsSync(distVersion)) {
  fail('node_modules/electron/dist/version is missing — the Electron dist/ folder is incomplete. See the "Electron install" section in README.md.');
}

const expectedVersion = require(path.join(electronDir, 'package.json')).version;
const actualVersion = fs.readFileSync(distVersion, 'utf-8').replace(/^v/, '').trim();
if (actualVersion !== expectedVersion) {
  fail(`node_modules/electron/dist/version says "${actualVersion}" but package.json expects "${expectedVersion}" — a stale or partial install. See the "Electron install" section in README.md.`);
}

const platformPath = fs.readFileSync(pathTxt, 'utf-8').trim();
const binaryPath = path.join(distDir, platformPath);
if (!fs.existsSync(binaryPath)) {
  fail(`The Electron binary itself is missing at:\n  ${binaryPath}\neven though path.txt points to it. See the "Electron install" section in README.md.`);
}

// Final, most important check: actually spawn the binary and confirm it
// runs. This is the real test — everything above can be individually
// present and the binary can still be corrupt/truncated.
// --no-sandbox is safe here specifically: --version never renders any
// content or executes untrusted code, so the sandbox has nothing to
// protect against. Without it, this check produces a false failure on
// environments that run as root (some Linux CI/containers) even when
// the binary is perfectly fine — unrelated to the real Windows failure
// this script exists to catch.
try {
  const out = execFileSync(binaryPath, ['--version', '--no-sandbox'], { timeout: 30000, encoding: 'utf-8' });
  console.log('[verify-electron] OK — Electron binary runs: ' + out.trim());
} catch (e) {
  fail(
    `The Electron binary exists but failed to run ("${binaryPath} --version"):\n` +
    (e.message || e) +
    '\n\nThis usually means the binary itself is truncated/corrupted (an interrupted\n' +
    'extraction can produce a file that exists but is not fully written). See the\n' +
    '"Electron install" section in README.md.'
  );
}
