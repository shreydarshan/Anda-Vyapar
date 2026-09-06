#!/usr/bin/env node
/**
 * scripts/install.js
 *
 * Runs `npm install` with Electron's download cache pinned to a known,
 * project-relative folder (.electron-cache) instead of npm's platform
 * default (e.g. %LOCALAPPDATA%\electron\Cache on Windows).
 *
 * Why this exists: @electron/get (used by node_modules/electron's own
 * postinstall) reads a raw environment variable, `electron_config_cache`
 * — NOT an npm config key. Entries in .npmrc are only ever exposed to
 * install scripts as `npm_config_<key>`, which @electron/get does not
 * read; verified directly, a .npmrc entry for this has no effect. A
 * real environment variable, set in the parent process before spawning
 * npm, is required — which is exactly what this script does, in a way
 * that works the same on Windows, macOS, and Linux without relying on
 * platform-specific batch/shell syntax.
 *
 * Pinning the cache location matters because if an install is ever
 * interrupted (see README.md "Electron install"), a naive "delete
 * node_modules and reinstall" can still fail the same way every time:
 * @electron/get may reuse an already-downloaded zip from its cache
 * without re-verifying it, reproducing the identical broken extraction.
 * With the cache pinned here, there's exactly one folder to also delete
 * when troubleshooting — not a platform-dependent guess.
 *
 * Usage: node scripts/install.js   (equivalent to running `npm install`)
 *        npm run setup             (same thing, via package.json)
 */
const { spawnSync } = require('child_process');
const path = require('path');

const cacheDir = path.join(__dirname, '..', '.electron-cache');
const env = Object.assign({}, process.env, { electron_config_cache: cacheDir });

console.log('[install] Electron download cache pinned to: ' + cacheDir);

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const extraArgs = process.argv.slice(2); // e.g. `node scripts/install.js --no-audit`
// shell: true is required on Windows: .cmd files (like npm.cmd) are not
// directly executable via the underlying CreateProcess call Node uses —
// they need cmd.exe to interpret them. Without this, spawnSync can fail
// with EINVAL before npm even starts. Harmless on macOS/Linux.
const result = spawnSync(npmCmd, ['install'].concat(extraArgs), { stdio: 'inherit', env, shell: true });

if (result.error) {
  console.error('[install] Failed to launch npm:', result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
