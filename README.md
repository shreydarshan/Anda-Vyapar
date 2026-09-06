# Anda Vyapar — Egg Business Manager

Local-first, offline-first desktop billing app for egg wholesalers.
Login is **optional** — the app always opens straight into Billing.
Supabase (when you choose to log in) adds cross-device backup and
sync; it is never required for day-to-day billing.

## Project layout

```text
anda-vyapar/
  electron/
    main.js              Local file persistence (per-account), daily
                          backups, printer IPC, native printing,
                          reads .env for Supabase config
    preload.js            Secure bridge — only specific APIs exposed

  src/
    index.html             App shell + optional login/signup modal
    css/
      legacy-base.css       Original layout/typography/print CSS
      buttons-3d.css        3D physical-control button system
      auth.css               Login/signup modal, offline banner
    js/
      config.js              Runtime config loader (no hardcoded creds)
      state.js                 Global business state + account scoping
      vendor/
        supabase-js.umd.js       Vendored Supabase SDK (bundled locally,
                                  no CDN dependency at runtime)
      auth/
        authService.js         Real Supabase Auth (signup/login/logout)
        authUI.js                Optional login modal — never a gate
      storage/
        accountStore.js          Switches local data between guest/users
        localStore.js             Account-scoped local persistence
        backup.js                  Daily backups, JSON export/import
      sync/
        syncQueue.js               Tracks pending changes, survives restart
        syncService.js              Push/pull against the REAL Supabase
                                     schema (see supabase/SCHEMA_NOTES.md)
        legacyMigration.js          Explicit "keep local / import" choice
                                     when guest data exists at login
      billing/
        rates.js, draft.js          Order creation, pricing, duplicate-
                                     bill guard
      stock/stock.js
      history/history.js
      udhar/udhar.js
      customers/ledger.js           This is the Suppliers page (purchase
                                     ledger) — file name kept for continuity
      reports/reports.js
      settings/settings.js
      printing/
        printService.js              Receipt building + native/iframe print
        printerSettings.js            Printer selection, readiness check,
                                       test print
      keyboard/shortcuts.js          F2/F4/F6/F8/F9 keyboard-first billing
      app/
        navigation.js, init.js        Boots straight to Billing; auth
                                       check happens after, in background

  supabase/
    SCHEMA_NOTES.md          Documentation of the REAL production schema.
                             There is intentionally NO migration SQL file
                             in this project — see below.

  .env.example             Copy to .env and fill in your own project
  .env                      NOT committed (see .gitignore)
```

## Setup

```bash
npm run setup             # installs deps with a pinned, reproducible
                           # Electron download cache — see below
cp .env.example .env      # fill in your Supabase project URL + publishable key
npm start                 # run in dev
npm run dist               # build the Windows installer
```

`npm install` also works as a plain equivalent, just without the
pinned-cache guarantee described below.

### Electron install (read this if `npm start` fails)

**This project now verifies its own Electron install automatically.**
Every `npm install` runs a `postinstall` check
(`scripts/verify-electron.js`) that fails loudly — with a clear,
specific message — if Electron's binary didn't install correctly,
instead of letting a broken install silently look successful. If you
see `ELECTRON INSTALL VERIFICATION FAILED` in the install output, the
message itself tells you which of the checks below failed.

**Recommended install command** (pins Electron's download cache to a
known project-relative folder instead of a scattered OS-default
location, so retries are reproducible — see `scripts/install.js` for
why this matters):

```bash
npm run setup
```

This is equivalent to `npm install` but with a predictable,
project-local Electron cache (`.electron-cache/`) instead of npm's
platform-default location. Plain `npm install` still works too, just
without that guarantee.

#### Root cause, if you hit this

Symptom: `node_modules/electron/dist/` has a `locales/` folder but no
`electron.exe` (Windows), and `npx electron --version` fails with
*"Electron failed to install correctly."* Traced directly from
Electron's own source (`node_modules/electron/index.js`):

- The error comes from `index.js`'s `getElectronPath()`, which
  resolves the binary **solely** from `node_modules/electron/path.txt`
  — it never checks whether `dist/electron.exe` itself exists. This is
  why manually copying `electron.exe` back into `dist/` does **not**
  fix it — `path.txt` is a separate bookkeeping file, not part of the
  official Electron zip, and it wasn't restored.
- `path.txt` is written by `install.js` **only as the very last step**,
  after a fully successful zip extraction. Any interruption during
  extraction (most commonly: real-time antivirus quarantining the
  freshly-extracted, unsigned `.exe`/DLLs — locale `.pak` data files
  are inert and unaffected, which is exactly the asymmetric pattern
  above) skips writing it, even though most other files did extract.
- Critically: **a later `npm install` does not reliably retry this**.
  If `node_modules/electron` already exists at the expected version,
  npm can skip re-running its postinstall entirely — confirmed by
  direct testing, not assumption. A naive "delete node_modules and
  reinstall" can appear to do nothing.

This is an external binary-download/extraction issue on the machine
running the install — not a bug in this project's `package.json`,
`main` field, or build config.

#### Fix, in order

1. Remove **both** the broken package and its external download cache
   — removing only one or the other is why retries can silently fail
   to fix anything:
   ```bash
   rmdir /s /q node_modules\electron
   rmdir /s /q .electron-cache
   rmdir /s /q "%LOCALAPPDATA%\electron\Cache"
   ```
2. If real-time antivirus is a plausible cause (check its
   quarantine/threat history around the install timestamp for
   `electron.exe`), add the project folder to its exclusions before
   reinstalling.
3. Reinstall with the pinned-cache command:
   ```bash
   npm run setup
   ```
4. The `postinstall` check runs automatically and will tell you
   immediately whether it worked — no need to manually inspect
   `dist/` or run `npx electron --version` yourself, though you can:
   ```bash
   npm run verify:electron
   ```
5. If your network blocks `github.com`/`githubusercontent.com`
   (common on some corporate networks — note the task description
   confirmed the URL itself was reachable, so this is unlikely to be
   your case, but included for completeness):
   ```bash
   set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
   npm run setup
   ```

Do **not** run `npm audit fix --force` to try to resolve this — it's
unrelated to the vulnerability warnings npm shows and can pull in
breaking dependency changes.

## About the Supabase project

**This app targets an already-existing production schema.** There is
no migration to run. `supabase/SCHEMA_NOTES.md` documents the real
tables (`business_settings`, `rates`, `customers`, `orders`,
`order_items`, `udhar_entries`, `stock_transactions`, `suppliers`,
`supplier_entries`) exactly as they exist in your project, all with
Row Level Security already enabled and scoped to `auth.uid()`.

If you ever set up a **new, empty** Supabase project for a different
deployment, you'd need someone to write a real migration by inspecting
that project's actual state first — never by guessing from a spec.

## What changed in this pass (fixing the earlier mistake)

An earlier version of this refactor shipped a migration file that
invented a schema (`order_user_id`, composite keys, `payments`/`stock`/
`profiles` tables) instead of inspecting the real database. Running it
failed with `column "order_user_id" does not exist` — because that
column, and the whole schema shape, never existed. That migration file
has been deleted. **No SQL was ever run against the production
database while fixing this** — only the application code was changed
to match the schema that was already there.

## Authentication model

- **Login is optional.** The app always boots straight into the
  Billing screen. Small Login / Sign Up buttons sit in the header;
  there is no gate.
- **Guest Mode**: all data lives locally (`accounts/guest/` on disk),
  fully functional — billing, stock, udhar, suppliers, history,
  reports, printing — with zero Supabase dependency.
- **Logging in** switches the local data context to that user's own
  account folder (`accounts/<user-id>/`). Guest data is never deleted
  or silently merged — if guest data exists at login time, you're
  asked explicitly: **Keep Local Only** or **Import Into My Account**.
- **Offline after login**: once authenticated on a device, that
  session persists locally (via the Supabase SDK's own local session
  cache). A missing/paused Supabase project never blocks billing —
  only cloud sync pauses, shown as a small "Offline" banner, never a
  fatal error screen.
- **User isolation** is enforced by the database's existing Row Level
  Security (`auth.uid() = user_id` on every table) — never by
  frontend filtering alone.

## Sync model

- **Local-first, always.** Every bill, stock change, udhar entry, and
  supplier purchase saves to disk immediately and is usable instantly.
  Cloud sync happens after, in the background, and never blocks the UI.
- **Idempotent orders**: pushed using the existing unique index on
  `(user_id, client_order_id)` — re-syncing an order safely upserts
  instead of duplicating.
- Other tables (`order_items`, `udhar_entries`, `stock_transactions`,
  `supplier_entries`) have no unique constraint of their own in the
  existing schema, so `syncService.js` keeps a small local "already
  synced" ledger (persisted per account, survives restart) to avoid
  re-inserting rows it has already pushed.
- **Every Supabase call checks `{ data, error }` explicitly.** A
  resolved promise is never treated as success without checking for
  an error first. Failed pushes retry with backoff; local data is
  never touched or lost because a cloud write failed.
- **Cloud restore**: logging in on a new device with no local data
  attempts a one-time pull from Supabase to repopulate the local
  store, if reachable.

## Receipt design

There is exactly one receipt layout in this app —
`buildReceiptBody()` + `wrapReceiptHtml()` in
`src/js/printing/printService.js`. The on-screen preview (an iframe
using `srcdoc`), the real thermal print, and the Printer Settings
Test Print all render the same generated HTML through the same
functions. There is no second/legacy receipt template anywhere in
the codebase — the old `buildSlip()`/`.slip`/`.srow`-style design and
its dead `@media print` CSS were removed entirely, not just visually
hidden.

## Printer behavior

- Bills save locally first, always.
- Printer readiness is checked two ways: a pre-check (installed +, on
  Windows, an idle `status` code) before attempting to print, and the
  real OS print callback afterward — the callback is the actual source
  of truth, since a pre-check can never fully prove a printer is
  physically powered on and loaded with paper.
- If a printer is detected as ready, the receipt prints automatically
  right after saving.
- If no printer is ready: the bill still saves successfully, a
  "Printer unavailable" notice shows, and the receipt stays available
  to print manually from the slip modal or History — **no automatic
  retry, no print queue, no backlog**. Reconnecting a printer later
  never triggers old bills to print on their own.
- A failed native print job **never** falls back to the Chrome/browser
  print dialog during normal billing — it's reported honestly as
  unavailable instead.

## If your H80i prints shifted left/right

This is almost always a **driver-level offset**, not something any web
page or Electron app can see or fix in software. Here's why: Windows
receipt-printer drivers rasterize whatever content Chromium sends into
their own defined "printable canvas" for the paper size you've selected
in **Devices & Printers → your H80i → Printing Preferences**. If that
driver dialog has its own "Page Setup," "Horizontal Position," or
"Offset" control, the paper physically shifts *after* our content has
already been rendered — no amount of CSS centering changes what happens
at that stage.

What this app does to help:
- Print margins are sent as explicit zero on all sides (Electron's
  `margins: { marginType: 'custom', top:0, bottom:0, left:0, right:0 }`),
  which is the most deterministic setting Chromium's print pipeline
  exposes — more reliable than the vaguer `marginType: 'none'`.
- **Settings → Printer → Left Margin (mm)** lets you nudge the receipt
  content a few mm left or right to compensate for whatever your
  specific driver does, without editing code. Print a **Test Print**,
  check the 30-character ruler line against the paper edges, adjust
  Left Margin, test again.
- If the shift is large and doesn't respond to that adjustment at all,
  check the H80i's own "Printing Preferences" dialog in Windows first
  — that's usually where the actual offset lives.

I was given `Helett_H80i_Driver_.exe` to inspect for this, but the
upload arrived as a 0-byte file, so nothing could be read from it. Even
a working driver installer wouldn't have exposed its internal offset
logic to static inspection anyway — that only shows up once installed,
inside the Windows print preferences UI on your machine.

## Known limitations

- **Supplier payments/settlements are local-only.** The real schema's
  `supplier_entries` table has no payment/settlement counterpart (no
  `is_payment` column like `udhar_entries` has), so paying down
  supplier credit is tracked on this device only and does not sync or
  restore on a new device. Purchases themselves (`is_credit` flag) do
  sync.
- **Stock transaction type mapping is a documented assumption**: local
  `IN` → `purchase`, `OUT` starting with "Order #" → `sale`, any other
  `OUT` → `adjustment`. There's no existing data to consult for the
  "correct" mapping, since your `stock_transactions` table starts
  empty.
- **Order timestamps on cloud restore** use the database's
  `created_at`, not the original local `ts` string, since `orders` has
  no separate "original local time" column.
- A live login round-trip against the real Supabase project could not
  be tested from this build environment (its network egress doesn't
  include `supabase.co`, only npm/github domains). The UI, config
  loading, and code paths are verified; a real login/signup/sync test
  needs to happen on your machine, which has normal internet access.
