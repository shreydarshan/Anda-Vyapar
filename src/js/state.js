/* ============================================================
   GLOBAL BUSINESS STATE
   Business rules (unchanged): 1 tray = 30 eggs, 1 box = 7 trays = 210 eggs
   ============================================================ */
const TE = 30, BE = 210; // TE = eggs/tray, BE = eggs/box

let lang = 'en';
let rates = { piece: null, tray: null, box: null };
let orders = [], counter = 0;
let di = [], dc = 0; // current draft items
let udhar = {};
let shop = { name: '', phone: '', addr: '', paperWidth: '80' };
let stock = { eggs: 0 };
let stockLog = [];
let histFilt = 'all';
let histSearch = '';
// "Show More" progressive reveal (spec: 20 -> 40 -> 60...), not a
// paged Prev/Next model — this is the specific pagination UX asked
// for, replacing an earlier Prev/Next implementation.
let histVisibleCount = 20;
const HIST_PAGE_SIZE = 20;
let stockLogFrom = '', stockLogTo = '', stockLogType = 'all';
let stockLogSearch = '';
let stockLogVisibleCount = 20;
const STOCK_LOG_PAGE_SIZE = 20;
let reportDaysShown = 30; // "Show all" expands this
let curSlipOrder = null;
let custLedger = {}; // {name:{phone,entries:[],totalOwed}}
let settleCtx = null;
let custPayCtx = null;
let custOweFilterActive = false;
let custPayCtxName = '';

// Cloud connection state (Supabase Auth session — separate from local data availability)
let sbConnected = false;
let isOnline = navigator.onLine;

// ── ACCOUNT SCOPE ──────────────────────────────────────────
// 'guest' until a user logs in; then the authenticated user's id.
// Local data is fully separated per account — see storage/accountStore.js
let currentAccountKey = 'guest';

// Clears in-memory business state before loading a different account's
// data, so User A's data never bleeds into Guest or User B's session.
// Bumped every time the active workspace's business data is torn down —
// on Reset Local Workspace AND on every account load/switch (this is
// called from applyPayload(), which every account switch goes through).
// pushAll() captures this at the start of a sync and re-checks it
// before each major write; if it's changed, that sync aborts instead
// of continuing to read/push whatever the NEW workspace's data now is.
// Without this, a sync already mid-flight when a reset or account
// switch happens could have its LATER steps (still-pending awaits
// resuming after the switch) read the new workspace's global state —
// e.g. an in-flight sync for Account A resuming into Account B's now-
// live `orders`/`rates`/`shop` globals, or a reset's blanked-out state
// reaching a step of a sync that started before the reset. SyncQueue
// being cleared only stops FUTURE syncs from being scheduled; it does
// nothing for one already running past that point.
let workspaceGeneration = 0;

function resetBusinessState() {
  workspaceGeneration++;
  rates = { piece: null, tray: null, box: null };
  orders = []; counter = 0;
  di = []; dc = 0;
  udhar = {};
  shop = { name: '', phone: '', addr: '', paperWidth: '80' };
  stock = { eggs: 0 };
  stockLog = [];
  custLedger = {};
}

// ── RUNTIME MODE ──────────────────────────────────────────
const K = 'av4_';
const IS_ELECTRON = typeof window.electronAPI !== 'undefined';
const IS_PYTHON_APP = !IS_ELECTRON && (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');
