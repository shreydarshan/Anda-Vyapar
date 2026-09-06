/* ============================================================
   SYNC SERVICE — REAL SCHEMA
   Local-first: billing NEVER waits on this. Pushes local state to
   the ACTUAL Supabase tables that already exist in production:

     business_settings(user_id,name,phone,address,auto_print,updated_at)
     rates(user_id,box,tray,piece,updated_at)
     customers(id,user_id,name,phone,created_at)
     orders(id,user_id,client_order_id,customer_name,customer_phone,
            is_udhar,total_eggs,total_amount,created_at)
     order_items(id,order_id,user_id,type,qty,rate,amount)
     udhar_entries(id,user_id,customer_name,order_id,amount,note,
                   is_payment,created_at)
     stock_transactions(id,user_id,type['sale'|'purchase'|'adjustment'],
                        eggs,reference,created_at)
     suppliers(id,user_id,name,created_at)
     supplier_entries(id,user_id,supplier_name,type,qty,rate,amount,
                      is_credit,created_at)

   No table/column is invented here. Every write is checked for
   { error } explicitly — a resolved promise is NOT success by itself.

   IDEMPOTENCY: orders use the existing unique index on
   (user_id, client_order_id) — client_order_id = the local order's
   own id, so re-syncing an already-pushed order safely upserts the
   same row instead of duplicating it. order_items, udhar_entries,
   stock_transactions and supplier_entries have no natural unique
   constraint in the existing schema, so this module keeps its own
   small "already synced" ledger (persisted locally, per account) and
   only inserts rows it hasn't sent before — since we cannot add a
   unique constraint ourselves without touching the DB schema.
   ============================================================ */
const SyncService = (function () {
  let timer = null;
  let syncing = false;

  function client() { return AuthService.isConfigured() ? AuthService.getClient() : null; }
  function uid() { const u = AuthService.getUser(); return u ? u.id : null; }
  function isReachable() { return !!(client() && uid() && navigator.onLine); }

  function withTimeout(promise, ms) {
    // The previous version never cleared its timeout timer once the
    // real request won the race (the common case — most requests
    // finish in well under 8s). Every one of those left a dangling
    // 8-second timer scheduled anyway, and with a full sync making
    // dozens of individual requests, that's dozens of wasted pending
    // timers accumulating every single sync cycle — a real, if slow,
    // contributor to "failed/finished requests piling up" over time.
    // Clearing it the moment either side settles stops that build-up.
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms || 8000);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
  // Every Supabase call goes through here — throws on { error }, so a
  // "didn't throw" promise resolution is never mistaken for success.
  async function run(promise, label) {
    const res = await withTimeout(promise);
    if (res && res.error) throw new Error((label || 'Supabase') + ': ' + res.error.message);
    return res;
  }

  // Upserts a (potentially large) row array in fixed-size chunks rather
  // than one giant request — this is the actual mechanism behind
  // removing the old hard 500-record cap: instead of truncating the
  // data to fit one request, keep the request small and let it take
  // as many requests as the real history needs. Each batch is still a
  // real upsert on the caller's onConflict key, so a batch failing
  // partway through (network drop mid-sync) just means the NEXT sync
  // attempt re-upserts from batch 0 again — safe, since every row here
  // already uses a deterministic id or a real unique constraint.
  async function upsertInBatches(table, rows, onConflict, label, batchSize) {
    if (!rows || !rows.length) return;
    const size = batchSize || 200;
    for (let i = 0; i < rows.length; i += size) {
      const chunk = rows.slice(i, i + size);
      await run(c_ref().from(table).upsert(chunk, { onConflict }), label || table);
    }
  }
  // Deletes by id, always additionally scoped to user_id (spec item 1:
  // "preserve account isolation" — even though these ids are already
  // account-namespaced via AndaUUID.v5(userId + ...) so a cross-account
  // collision is not realistically possible, filtering by user_id too
  // is a free, cheap extra guarantee that a delete can never touch a
  // row belonging to a different account).
  async function deleteInBatches(table, userId, ids, label, batchSize) {
    if (!ids || !ids.length) return;
    const size = batchSize || 200;
    for (let i = 0; i < ids.length; i += size) {
      const chunk = ids.slice(i, i + size);
      await run(c_ref().from(table).delete().eq('user_id', userId).in('id', chunk), label || ('delete ' + table));
    }
  }
  function c_ref() { return client(); } // small indirection so upsertInBatches can be defined before `c` exists in pushAll's scope

  // ── LOCAL SYNC FINGERPRINT LEDGER (per account, survives restart) ───
  // Root-cause fix (V21 stability pass, item 3): pushAll() used to
  // re-upsert EVERY order/item/udhar-entry/stock-log-line/supplier-
  // entry on every single sync cycle (every 45s), regardless of
  // whether anything about it had changed since the last successful
  // push. For a business with a real order history that meant
  // hundreds of unnecessary network requests every cycle, forever.
  // This stores a small content fingerprint per record id and skips
  // any record whose fingerprint hasn't changed — the upsert/
  // idempotency guarantees are completely unchanged (still real
  // deterministic ids + upsert), only WHICH rows get included in a
  // given push changes. If the fingerprint ledger is ever missing,
  // corrupted, or in the old pre-incremental format, everything is
  // treated as "changed" and gets pushed — the safe direction to fail
  // in (a redundant push, never a skipped one).
  function syncedKey() { return 'av4_synced_' + currentAccountKey; }
  function loadFingerprints() {
    try {
      const raw = JSON.parse(localStorage.getItem(syncedKey()) || '{}');
      // Old format was a plain array of ids (no fingerprints at all).
      // Detected and discarded rather than misread — this forces
      // exactly one full push after upgrading, then incremental
      // behavior applies from then on. Never causes a missed update.
      if (Array.isArray(raw)) return { orders: {}, stock: {}, udhar: {}, supplier: {}, orderItems: {} };
      return {
        orders: raw.orders || {}, stock: raw.stock || {}, udhar: raw.udhar || {}, supplier: raw.supplier || {},
        // orderItems maps a pushed order_item's cloud row id -> the
        // LOCAL order id it belongs to (spec item 1: needed to detect
        // "this specific item used to exist under this order, and no
        // longer does" when an order is edited to remove a line item).
        orderItems: raw.orderItems || {}
      };
    } catch (e) { return { orders: {}, stock: {}, udhar: {}, supplier: {}, orderItems: {} }; }
  }
  function saveFingerprints(fp) {
    try { localStorage.setItem(syncedKey(), JSON.stringify(fp)); } catch (e) {}
  }
  // Deterministic, order-independent-enough signature of a row's
  // actual synced content. Not a security hash — just needs to change
  // whenever anything that would change the upserted row changes.
  function fingerprint(obj) { return JSON.stringify(obj); }

  // ── FINGERPRINT RECONCILIATION (spec section 6) ─────────────────────
  // Root-cause gap identified in the final audit: the incremental-sync
  // fingerprint check above (`if (fp.orders[o.id] && fp.orders[o.id].sig
  // === sig) continue`) assumes "fingerprint unchanged" means "the
  // cloud row still exists". That assumption breaks the moment the
  // cloud row is EVER removed by anything other than this app's own
  // orphan-cleanup diffs above — a manual delete in the Supabase
  // dashboard, a partially-failed Delete Cloud Data run on another
  // device sharing the same account, or any future admin/maintenance
  // action. Once that happens, this device's fingerprint ledger still
  // says "unchanged, already synced" forever, so that record silently
  // never gets pushed again — a permanent, invisible cloud data gap
  // with no error and no user-visible symptom.
  //
  // Fix: once a day (not every 45s — spec section 6 explicitly rules
  // out reverting to a full push every cycle), fetch just the `id`
  // column for every synced table and drop any fingerprint entry whose
  // recorded cloud id is no longer present. A dropped fingerprint just
  // means "treat this record as unsynced" — the very next pushAll()
  // (which always runs right after this, same sync cycle) then
  // re-uploads it normally through the exact same upsert path as any
  // other change, so this stays a small, id-only read plus the
  // existing lightweight incremental push — never a full-database
  // re-upload.
  function lastReconcileKey() { return 'av4_sync_last_reconcile_' + currentAccountKey; }
  const RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;
  async function reconcileFingerprintsIfDue(fp) {
    const last = parseInt(localStorage.getItem(lastReconcileKey()) || '0', 10);
    if (Date.now() - last < RECONCILE_INTERVAL_MS) return false;
    const c = client(); const userId = uid();
    if (!c || !userId) return false;
    const myGeneration = workspaceGeneration;
    try {
      const [ordRes, udharRes, stockRes, supRes, itemRes] = await Promise.all([
        run(c.from('orders').select('id').eq('user_id', userId), 'reconcile orders'),
        run(c.from('udhar_entries').select('id').eq('user_id', userId), 'reconcile udhar_entries'),
        run(c.from('stock_transactions').select('id').eq('user_id', userId), 'reconcile stock_transactions'),
        run(c.from('supplier_entries').select('id').eq('user_id', userId), 'reconcile supplier_entries'),
        run(c.from('order_items').select('id').eq('user_id', userId), 'reconcile order_items')
      ]);
      // Same mid-flight safety as pushAll's own checkGen() — an account
      // switch/reset/logout during this read means these results belong
      // to a workspace that's no longer current; discard them rather
      // than acting on foreign data.
      if (workspaceGeneration !== myGeneration) return false;
      const ordIds = new Set((ordRes.data || []).map(r => r.id));
      const udharIds = new Set((udharRes.data || []).map(r => r.id));
      const stockIds = new Set((stockRes.data || []).map(r => r.id));
      const supIds = new Set((supRes.data || []).map(r => r.id));
      const itemIds = new Set((itemRes.data || []).map(r => r.id));
      let changed = false;
      for (const localId of Object.keys(fp.orders)) {
        const cloudId = fp.orders[localId] && fp.orders[localId].cloudId;
        if (cloudId && !ordIds.has(cloudId)) { delete fp.orders[localId]; changed = true; }
      }
      for (const id of Object.keys(fp.udhar)) if (!udharIds.has(id)) { delete fp.udhar[id]; changed = true; }
      for (const id of Object.keys(fp.stock)) if (!stockIds.has(id)) { delete fp.stock[id]; changed = true; }
      for (const id of Object.keys(fp.supplier)) if (!supIds.has(id)) { delete fp.supplier[id]; changed = true; }
      for (const id of Object.keys(fp.orderItems)) if (!itemIds.has(id)) { delete fp.orderItems[id]; changed = true; }
      // Recorded as done regardless of `changed` — a clean reconciliation
      // (nothing stale found) is still a completed reconciliation and
      // must not re-run again for another full interval.
      localStorage.setItem(lastReconcileKey(), String(Date.now()));
      return changed;
    } catch (e) {
      // Non-fatal by design: a failed reconciliation attempt (offline,
      // timeout, RLS hiccup) just means it stays due and is retried on
      // the next sync cycle — normal pushAll() behavior is completely
      // unaffected either way.
      console.warn('[Sync] fingerprint reconciliation failed (will retry later):', e.message);
      return false;
    }
  }

  // ── PUSH ───────────────────────────────────────────────────────────
  async function pushAll() {
    const c = client(); const userId = uid();
    if (!c || !userId) return false;
    const fp = loadFingerprints();
    await reconcileFingerprintsIfDue(fp); // mutates fp in place when a stale entry is found; safe no-op most days

    // Captured once, checked before every major write below. If a
    // reset or account switch happens while this sync is mid-flight,
    // the generation changes and every subsequent step aborts instead
    // of continuing to read the NEW workspace's (or blanked-out) live
    // globals — see the comment on workspaceGeneration in state.js.
    const myGeneration = workspaceGeneration;
    function checkGen() {
      if (workspaceGeneration !== myGeneration) throw new Error('workspace changed mid-sync — aborted, will not push stale/foreign data');
    }

    // business_settings — blank means blank, both locally and in the
    // cloud. This used to fall back to the literal string 'Anda Vyapar'
    // whenever shop.name was empty, which silently overwrote a
    // deliberately-blank shop name with a fake one the moment it
    // synced — the same bug already fixed on the receipt-rendering
    // side, just also present here in the sync layer.
    await run(c.from('business_settings').upsert({
      user_id: userId, name: shop.name || '', phone: shop.phone || '', address: shop.addr || '',
      auto_print: shop.autoPrint !== false
    }, { onConflict: 'user_id' }), 'business_settings');
    checkGen();

    // rates
    await run(c.from('rates').upsert({
      user_id: userId, box: rates.box || 0, tray: rates.tray || 0, piece: rates.piece || 0
    }, { onConflict: 'user_id' }), 'rates');
    checkGen();

    // customers (distinct billing customer names seen in orders — NOT suppliers)
    const walkinNames = new Set(['Walk-in', 'सामान्य ग्राहक']);
    const custMap = {};
    orders.forEach(o => { if (o.cname && !walkinNames.has(o.cname)) custMap[o.cname] = o.cphone || custMap[o.cname] || ''; });
    const custRows = Object.keys(custMap).map(name => ({ user_id: userId, name, phone: custMap[name] || '' }));
    if (custRows.length) await run(c.from('customers').upsert(custRows, { onConflict: 'user_id,name' }), 'customers');
    checkGen();

    // orders — upsert keyed by (user_id, client_order_id); returns cloud ids.
    // Incremental (spec item 3): an order whose fingerprint matches
    // what was pushed last time is skipped entirely — new orders and
    // EDITED orders (their fingerprint changes the moment any pushed
    // field changes) still always get included. orderIdMap is still
    // built for every UNCHANGED order too, from the cloud id already
    // on record — needed below so udhar_entries can still link to any
    // order, not just ones that happened to be resynced this cycle.
    const orderIdMap = {}; // local order.id -> cloud orders.id (uuid)
    const PUSH_BATCH_SIZE = 200;
    const changedOrders = [];
    for (const o of orders) {
      const rowShape = {
        client_order_id: String(o.id), customer_name: o.cname || 'Walk-in', customer_phone: o.cphone || '',
        is_udhar: !!o.isUdhar, total_eggs: o.totalEggs || 0, total_amount: o.totalAmt || 0,
        items: (o.items || []).map(it => [it.id, it.type, it.qty, it.ur, it.amt]) // included so an item-level edit changes the order's own fingerprint too
      };
      const sig = fingerprint(rowShape);
      if (fp.orders[o.id] && fp.orders[o.id].sig === sig) {
        if (fp.orders[o.id].cloudId) orderIdMap[o.id] = fp.orders[o.id].cloudId;
        continue; // unchanged since last successful push — nothing to do
      }
      changedOrders.push({ o, sig });
    }
    if (changedOrders.length) {
      for (let i = 0; i < changedOrders.length; i += PUSH_BATCH_SIZE) {
        checkGen(); // re-checked every batch, not just once — a long orders history means many awaited round-trips here
        const batch = changedOrders.slice(i, i + PUSH_BATCH_SIZE);
        const orderRows = batch.map(({ o }) => ({
          user_id: userId, client_order_id: String(o.id),
          customer_name: o.cname || 'Walk-in', customer_phone: o.cphone || '',
          is_udhar: !!o.isUdhar, total_eggs: o.totalEggs || 0, total_amount: o.totalAmt || 0
        }));
        const res = await run(c.from('orders').upsert(orderRows, { onConflict: 'user_id,client_order_id' }).select('id,client_order_id'), 'orders');
        (res.data || []).forEach(row => { orderIdMap[row.client_order_id] = row.id; });

        // order_items for this same batch — deterministic id (order id +
        // item id) + upsert. Idempotent even if a previous sync attempt
        // died mid-way: retrying with the same rows/ids just re-upserts
        // the same cloud rows. Only pushed for orders that actually
        // changed this cycle (see fingerprint check above) — an
        // unchanged order's items are, by definition, also unchanged.
        const itemRows = [];
        // Root-cause fix (V22 stability pass, item 1 — stale
        // order_items on edit): editing an order to REMOVE a line item
        // used to leave that item's cloud row behind forever — nothing
        // ever issued a delete for it, since pushAll() only ever
        // upserted whatever was CURRENTLY in o.items. For each changed
        // order, compare "item ids fp.orderItems already has on record
        // for this order" against "item ids o.items has right now" —
        // anything only in the former was removed by the edit and must
        // be deleted from the cloud, not just left orphaned.
        const removedItemIds = [];
        for (const { o } of batch) {
          const currentItemIds = new Set((o.items || []).map(it => String(it.id)));
          for (const [cloudItemId, mapping] of Object.entries(fp.orderItems)) {
            if (mapping.orderId !== o.id) continue;
            if (!currentItemIds.has(String(mapping.itemId))) removedItemIds.push(cloudItemId);
          }
        }
        for (const { o } of batch) {
          const cloudOrderId = orderIdMap[String(o.id)];
          if (!cloudOrderId) continue; // this order's upsert didn't return a row this pass — retry next pass
          for (const it of (o.items || [])) {
            const id = await AndaUUID.v5('order_item:' + userId + ':' + o.id + ':' + it.id);
            itemRows.push({ id, order_id: cloudOrderId, user_id: userId, type: it.type, qty: it.qty, rate: it.ur, amount: it.amt, _localOrderId: o.id, _localItemId: it.id });
          }
        }
        if (itemRows.length) {
          // _localOrderId/_localItemId are bookkeeping only — never sent to Supabase.
          const cloudRows = itemRows.map(({ _localOrderId, _localItemId, ...rest }) => rest);
          await upsertInBatches('order_items', cloudRows, 'id', 'order_items');
          for (const row of itemRows) fp.orderItems[row.id] = { orderId: row._localOrderId, itemId: row._localItemId };
        }

        // Delete cloud order_item rows for items that were removed by
        // this edit (see removedItemIds above). Safe even if this list
        // is stale/wrong in some edge case: it only ever contains ids
        // this exact sync process just computed as "no longer present
        // locally for an order we ARE currently re-syncing", scoped to
        // this user — never an arbitrary/unrelated row.
        if (removedItemIds.length) {
          await deleteInBatches('order_items', userId, removedItemIds, 'order_items delete');
          for (const id of removedItemIds) delete fp.orderItems[id];
        }

        // Only record the fingerprint for orders that actually got a
        // cloud id back this pass — a batch that failed partway
        // through leaves those orders' old (or absent) fingerprints in
        // place, so the NEXT sync attempt correctly retries them
        // instead of being skipped as "already synced".
        for (const { o, sig } of batch) {
          const cloudOrderId = orderIdMap[String(o.id)];
          if (cloudOrderId) fp.orders[o.id] = { sig, cloudId: cloudOrderId };
        }
      }
    }
    checkGen();

    // Root-cause fix (V22 stability pass, item 1 — deleted orders):
    // deleteOrder() removes the order from the local `orders` array,
    // but nothing ever told the cloud — the order's row, AND every one
    // of its order_items rows, stayed behind forever. fp.orders is a
    // record of every order id this device has ever successfully
    // pushed; any id in there that's no longer in the local `orders`
    // array was deleted locally since the last sync and must be
    // deleted from the cloud too.
    const stillLocalOrderIds = new Set(orders.map(o => String(o.id)));
    const deletedOrderLocalIds = Object.keys(fp.orders).filter(id => !stillLocalOrderIds.has(String(id)));
    if (deletedOrderLocalIds.length) {
      const cloudOrderIdsToDelete = deletedOrderLocalIds.map(id => fp.orders[id].cloudId).filter(Boolean);
      const cloudItemIdsToDelete = Object.keys(fp.orderItems).filter(itemId => deletedOrderLocalIds.includes(String(fp.orderItems[itemId].orderId)));
      // Items first, then the order itself — if a foreign key from
      // order_items to orders exists, deleting the parent first would
      // fail; deleting children first is always safe regardless.
      if (cloudItemIdsToDelete.length) await deleteInBatches('order_items', userId, cloudItemIdsToDelete, 'order_items delete (order removed)');
      if (cloudOrderIdsToDelete.length) await deleteInBatches('orders', userId, cloudOrderIdsToDelete, 'orders delete');
      for (const id of deletedOrderLocalIds) delete fp.orders[id];
      for (const id of cloudItemIdsToDelete) delete fp.orderItems[id];
    }
    checkGen();

    // udhar_entries — debit rows (is_payment=false) + settlement rows
    // (is_payment=true). Deterministic id + upsert: safe against retries,
    // restarts, and partial failures (see AndaUUID doc comment).
    // Incremental (spec item 3): same fingerprint-skip pattern as
    // orders — only new/changed entries get included in the upsert.
    const udharRows = [];
    const udharSigs = {};
    for (const name of Object.keys(udhar || {})) {
      for (const e of (udhar[name].entries || [])) {
        const id = await AndaUUID.v5('udhar_debit:' + userId + ':' + name + ':' + e.ts);
        const cloudOrderId = e.orderId != null ? orderIdMap[String(e.orderId)] : null;
        const row = { id, user_id: userId, customer_name: name, order_id: cloudOrderId || null, amount: e.amt, note: e.itemDesc || '', is_payment: false };
        const sig = fingerprint(row);
        udharSigs[id] = sig;
        if (fp.udhar[id] === sig) continue;
        udharRows.push(row);
      }
      for (const s of (udhar[name].settlements || [])) {
        const id = await AndaUUID.v5('udhar_payment:' + userId + ':' + name + ':' + s.ts);
        const row = { id, user_id: userId, customer_name: name, order_id: null, amount: s.amt, note: 'Settlement', is_payment: true };
        const sig = fingerprint(row);
        udharSigs[id] = sig;
        if (fp.udhar[id] === sig) continue;
        udharRows.push(row);
      }
    }
    checkGen();
    if (udharRows.length) await upsertInBatches('udhar_entries', udharRows, 'id', 'udhar_entries');
    for (const row of udharRows) fp.udhar[row.id] = udharSigs[row.id];
    // Root-cause fix (V22 stability pass, item 1 — orphaned udhar
    // rows): a settled/deleted entry, or one that moved to a different
    // customer during an order edit, used to leave its old cloud row
    // behind forever. udharSigs was built from EVERY currently-existing
    // local entry above (not just changed ones), so anything in
    // fp.udhar that's missing from udharSigs no longer exists locally
    // and must be deleted from the cloud.
    const goneUdharIds = Object.keys(fp.udhar).filter(id => !(id in udharSigs));
    if (goneUdharIds.length) {
      await deleteInBatches('udhar_entries', userId, goneUdharIds, 'udhar_entries delete');
      for (const id of goneUdharIds) delete fp.udhar[id];
    }
    checkGen();

    // stock_transactions — map local IN/OUT log to sale/purchase/adjustment
    // Mapping used (documented assumption, no schema to consult otherwise):
    //   OUT + note starting "Order #"  -> 'sale'      (billed to a customer)
    //   IN                              -> 'purchase'  (received / bought in)
    //   OUT + anything else (manual)    -> 'adjustment' (manual correction/removal)
    // Incremental: same fingerprint-skip pattern.
    const stockRows = [];
    const stockSigs = {};
    for (const s of (stockLog || [])) {
      const eggs = (s.boxes || 0) * BE + (s.trays || 0) * TE + (s.pieces || 0);
      if (!eggs) continue;
      const id = await AndaUUID.v5('stock_tx:' + userId + ':' + s.ts + ':' + (s.note || ''));
      const type = s.type === 'IN' ? 'purchase' : (s.note && s.note.indexOf('Order #') === 0 ? 'sale' : 'adjustment');
      const row = { id, user_id: userId, type, eggs, reference: s.note || '' };
      const sig = fingerprint(row);
      stockSigs[id] = sig;
      if (fp.stock[id] === sig) continue;
      stockRows.push(row);
    }
    checkGen();
    if (stockRows.length) await upsertInBatches('stock_transactions', stockRows, 'id', 'stock_transactions');
    for (const row of stockRows) fp.stock[row.id] = stockSigs[row.id];
    // Same orphan cleanup as udhar above — covers clearStockLog()
    // (wipes the whole local log) as well as any future path that
    // might remove individual stock log entries.
    const goneStockIds = Object.keys(fp.stock).filter(id => !(id in stockSigs));
    if (goneStockIds.length) {
      await deleteInBatches('stock_transactions', userId, goneStockIds, 'stock_transactions delete');
      for (const id of goneStockIds) delete fp.stock[id];
    }
    checkGen();

    // suppliers + supplier_entries (this is the app's "Suppliers" page —
    // custLedger is the local variable name, kept for compatibility).
    // suppliers already has a real UNIQUE(user_id,name) constraint
    // (verified live against the production DB) so its upsert was
    // already safe; supplier_entries gets the same deterministic-id
    // treatment as the other unconstrained tables, plus the same
    // fingerprint-skip incremental behavior.
    const supplierNames = Object.keys(custLedger || {});
    const supplierSigs = {}; // declared outside the if-block so the
                              // orphan-cleanup diff below still works
                              // correctly even when every supplier has
                              // been deleted locally (supplierNames is
                              // empty) — that's precisely the case
                              // that must still clean up the cloud.
    if (supplierNames.length) {
      await run(c.from('suppliers').upsert(supplierNames.map(name => ({ user_id: userId, name })), { onConflict: 'user_id,name' }), 'suppliers');
      checkGen();
      const entryRows = [];
      for (const name of supplierNames) {
        for (const e of (custLedger[name].entries || [])) {
          const id = await AndaUUID.v5('supplier_entry:' + userId + ':' + name + ':' + e.ts);
          const row = { id, user_id: userId, supplier_name: name, type: e.type, qty: e.qty, rate: e.ratePerEgg || 0, amount: e.origAmt != null ? e.origAmt : e.amt, is_credit: !!e.isCredit };
          const sig = fingerprint(row);
          supplierSigs[id] = sig;
          if (fp.supplier[id] === sig) continue;
          entryRows.push(row);
        }
        // NOTE: supplier payments/settlements (custLedger[name].payments) have
        // no matching table in the existing schema (supplier_entries has no
        // is_payment column) — they stay local-only. See README limitations.
      }
      if (entryRows.length) await upsertInBatches('supplier_entries', entryRows, 'id', 'supplier_entries');
      for (const row of entryRows) fp.supplier[row.id] = supplierSigs[row.id];
    }
    // Root-cause fix (V22 stability pass, item 1 — orphaned supplier
    // entries): delCustEntry() removing a purchase entry used to leave
    // its cloud row behind forever. Same diff pattern as udhar/stock —
    // runs regardless of whether supplierNames is empty, since a
    // supplier's entries can be deleted individually via delCustEntry()
    // even while the supplier itself still has other entries, AND the
    // case where every supplier was removed still needs cleanup.
    const goneSupplierIds = Object.keys(fp.supplier).filter(id => !(id in supplierSigs));
    if (goneSupplierIds.length) {
      await deleteInBatches('supplier_entries', userId, goneSupplierIds, 'supplier_entries delete');
      for (const id of goneSupplierIds) delete fp.supplier[id];
    }


    // Only persisted on full success — if pushAll() throws partway
    // through (network drop, workspace change), none of this attempt's
    // fingerprint updates are saved, so the next attempt correctly
    // re-treats everything from the failed point onward as unsynced
    // and retries it. Redundant, never lossy — same philosophy the
    // batch retry logic above already relies on.
    saveFingerprints(fp);
    return true;
  }

  async function syncWithRetry(maxAttempts) {
    maxAttempts = maxAttempts || 4;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try { await pushAll(); return true; }
      catch (e) {
        console.warn('[Sync] attempt', attempt + 1, 'failed:', e.message);
        // A workspace-changed abort (reset or account switch mid-sync)
        // is not a transient failure to retry — retrying would just
        // immediately push the NEW workspace's data under the guise of
        // finishing the OLD sync. The next natural sync trigger (the
        // periodic timer, reconnect, or another explicit save) will
        // correctly pick up and push whatever the new/current
        // workspace actually is.
        if (e.message && e.message.indexOf('workspace changed mid-sync') !== -1) return false;
        if (attempt < maxAttempts - 1) await new Promise(r => setTimeout(r, Math.min(8000, 1000 * Math.pow(2, attempt))));
      }
    }
    return false; // local data is untouched either way — nothing lost
  }

  // ── PULL (cloud restore — new device / empty local account) ─────────
  async function pullAll() {
    const c = client(); const userId = uid();
    if (!c || !userId) return false;

    const [bs, rt, ords, udh, stx, sup, se] = await Promise.all([
      run(c.from('business_settings').select('*').eq('user_id', userId).maybeSingle(), 'pull business_settings'),
      run(c.from('rates').select('*').eq('user_id', userId).maybeSingle(), 'pull rates'),
      run(c.from('orders').select('*').eq('user_id', userId).order('created_at', { ascending: true }), 'pull orders'),
      run(c.from('udhar_entries').select('*').eq('user_id', userId), 'pull udhar_entries'),
      run(c.from('stock_transactions').select('*').eq('user_id', userId), 'pull stock_transactions'),
      run(c.from('suppliers').select('*').eq('user_id', userId), 'pull suppliers'),
      run(c.from('supplier_entries').select('*').eq('user_id', userId), 'pull supplier_entries')
    ]);

    const hasAnything = (ords.data && ords.data.length) || (udh.data && udh.data.length) || (stx.data && stx.data.length) || (sup.data && sup.data.length) || bs.data;
    if (!hasAnything) return false; // genuinely a brand-new account, nothing to restore

    resetBusinessState();

    if (bs.data) { shop.name = bs.data.name || ''; shop.phone = bs.data.phone || ''; shop.addr = bs.data.address || ''; shop.autoPrint = bs.data.auto_print !== false; }
    if (rt.data) { rates.box = rt.data.box || null; rates.tray = rt.data.tray || null; rates.piece = rt.data.piece || null; }

    // Orders + items
    const cloudOrders = ords.data || [];
    let maxLocalId = 0;
    const cloudIdToLocalId = {};
    const orderItemsByOrderId = {};
    if (cloudOrders.length) {
      const itemsRes = await run(c.from('order_items').select('*').in('order_id', cloudOrders.map(o => o.id)), 'pull order_items');
      (itemsRes.data || []).forEach(it => { (orderItemsByOrderId[it.order_id] = orderItemsByOrderId[it.order_id] || []).push(it); });
    }
    orders = sanitizeOrders(cloudOrders.map(o => {
      const localId = parseInt(o.client_order_id, 10);
      const id = Number.isFinite(localId) ? localId : (++maxLocalId + 100000);
      maxLocalId = Math.max(maxLocalId, id);
      cloudIdToLocalId[o.id] = id;
      const items = (orderItemsByOrderId[o.id] || []).map((it, i) => ({ id: i + 1, type: it.type, qty: it.qty, eggs: (it.type === 'piece' ? it.qty : it.type === 'tray' ? it.qty * TE : it.qty * BE), ur: it.rate, amt: it.amount }));
      const created = new Date(o.created_at);
      return {
        id, cname: o.customer_name, cphone: o.customer_phone || '', items,
        totalEggs: o.total_eggs, totalAmt: o.total_amount,
        paid: !o.is_udhar, isUdhar: !!o.is_udhar,
        ts: created.toLocaleString('en-IN'), isoDate: localIsoDate(created)
      };
    })).sort((a, b) => b.id - a.id);
    counter = maxLocalId;

    // Udhar — split by is_payment
    (udh.data || []).forEach(row => {
      if (!udhar[row.customer_name]) udhar[row.customer_name] = { entries: [], total: 0, settlements: [] };
      const rowDate = new Date(row.created_at);
      const ts = rowDate.toLocaleString('en-IN');
      const isoDate = localIsoDate(rowDate);
      if (row.is_payment) {
        udhar[row.customer_name].settlements.push({ amt: row.amount, ts, isoDate });
      } else {
        const localOrderId = row.order_id ? cloudIdToLocalId[row.order_id] : null;
        udhar[row.customer_name].entries.push({ orderId: localOrderId || null, amt: row.amount, itemDesc: row.note || '', boxes: 0, trays: 0, pieces: 0, totalEggs: 0, ts, settled: false });
      }
    });
    Object.keys(udhar).forEach(name => {
      const paid = udhar[name].settlements.reduce((s, p) => s + p.amt, 0);
      const owed = udhar[name].entries.reduce((s, e) => s + e.amt, 0);
      udhar[name].total = Math.max(0, +(owed - paid).toFixed(2));
    });

    // Stock — reconstruct log + current total from stock_transactions.
    // Sign convention (see pushAll comment): purchase=+, sale=-, adjustment=-
    let eggTotal = 0;
    stockLog = (stx.data || []).map(row => {
      const rowDate = new Date(row.created_at);
      const ts = rowDate.toLocaleString('en-IN');
      const isoDate = localIsoDate(rowDate);
      if (row.type === 'purchase') eggTotal += row.eggs; else eggTotal -= row.eggs;
      const bd = eggBD(row.eggs);
      return { ts, isoDate, type: row.type === 'purchase' ? 'IN' : 'OUT', boxes: bd.boxes, trays: bd.trays, pieces: bd.pieces, note: row.reference || '' };
    }).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    stock.eggs = Math.max(0, eggTotal);

    // Suppliers ledger (payment history does not restore — see limitations)
    (sup.data || []).forEach(s => { custLedger[s.name] = { phone: '', entries: [], payments: [], totalOwed: 0, totalBoxesBought: 0 }; });
    (se.data || []).forEach(row => {
      if (!custLedger[row.supplier_name]) custLedger[row.supplier_name] = { phone: '', entries: [], payments: [], totalOwed: 0, totalBoxesBought: 0 };
      const bd = eggBD(row.type === 'piece' ? row.qty : row.type === 'tray' ? row.qty * TE : row.qty * BE);
      const rowDate = new Date(row.created_at);
      const ts = rowDate.toLocaleString('en-IN');
      const isoDate = localIsoDate(rowDate);
      custLedger[row.supplier_name].entries.push({ type: row.type, qty: row.qty, ratePerEgg: row.rate, eggs: bd.boxes * BE + bd.trays * TE + bd.pieces, boxes: bd.boxes, trays: bd.trays, pieces: bd.pieces, amt: row.amount, origAmt: row.amount, isCredit: !!row.is_credit, paid: !row.is_credit, ts, isoDate });
      if (row.is_credit) custLedger[row.supplier_name].totalOwed = +(custLedger[row.supplier_name].totalOwed + row.amount).toFixed(2);
      custLedger[row.supplier_name].totalBoxesBought += bd.boxes;
    });

    // Final normalization pass — cloud rows should already be well-typed
    // (Postgres numeric columns), but this guarantees the same safe
    // shape as every other entry point regardless.
    udhar = sanitizeUdhar(udhar);
    custLedger = sanitizeCustLedger(custLedger);

    // Everything just pulled counts as already-synced so the next push
    // doesn't immediately re-insert what we just restored. Fingerprints
    // are computed with the exact same row shape pushAll() uses for
    // each table, so a push immediately after a pull correctly sees
    // "unchanged" and skips them — same incremental behavior applies
    // right away rather than only from the second sync onward.
    const fp = { orders: {}, stock: {}, udhar: {}, supplier: {}, orderItems: {} };
    for (const o of orders) {
      const cloudId = cloudIdByLocalOrderId[o.id];
      if (!cloudId) continue;
      const sig = fingerprint({
        client_order_id: String(o.id), customer_name: o.cname || 'Walk-in', customer_phone: o.cphone || '',
        is_udhar: !!o.isUdhar, total_eggs: o.totalEggs || 0, total_amount: o.totalAmt || 0,
        items: (o.items || []).map(it => [it.id, it.type, it.qty, it.ur, it.amt])
      });
      fp.orders[o.id] = { sig, cloudId };
      // Populate orderItems too (spec item 1 fix) — otherwise a push
      // immediately after this pull would see fp.orderItems as empty
      // and wrongly conclude every item on every order was "removed
      // locally", deleting them all from the cloud right after
      // restoring them. Must mirror pushAll()'s own item-id formula
      // exactly so the ids line up.
      for (const it of (o.items || [])) {
        const itemId = await AndaUUID.v5('order_item:' + userId + ':' + o.id + ':' + it.id);
        fp.orderItems[itemId] = { orderId: o.id, itemId: it.id };
      }
    }
    for (const name of Object.keys(udhar)) {
      for (const e of udhar[name].entries) {
        const id = await AndaUUID.v5('udhar_debit:' + userId + ':' + name + ':' + e.ts);
        fp.udhar[id] = fingerprint({ id, user_id: userId, customer_name: name, order_id: e.orderId != null ? cloudIdByLocalOrderId[e.orderId] || null : null, amount: e.amt, note: e.itemDesc || '', is_payment: false });
      }
      for (const s of udhar[name].settlements) {
        const id = await AndaUUID.v5('udhar_payment:' + userId + ':' + name + ':' + s.ts);
        fp.udhar[id] = fingerprint({ id, user_id: userId, customer_name: name, order_id: null, amount: s.amt, note: 'Settlement', is_payment: true });
      }
    }
    for (const s of stockLog) {
      const eggs = (s.boxes || 0) * BE + (s.trays || 0) * TE + (s.pieces || 0);
      if (!eggs) continue;
      const id = await AndaUUID.v5('stock_tx:' + userId + ':' + s.ts + ':' + (s.note || ''));
      const type = s.type === 'IN' ? 'purchase' : (s.note && s.note.indexOf('Order #') === 0 ? 'sale' : 'adjustment');
      fp.stock[id] = fingerprint({ id, user_id: userId, type, eggs, reference: s.note || '' });
    }
    for (const name of Object.keys(custLedger)) {
      for (const e of custLedger[name].entries) {
        const id = await AndaUUID.v5('supplier_entry:' + userId + ':' + name + ':' + e.ts);
        fp.supplier[id] = fingerprint({ id, user_id: userId, supplier_name: name, type: e.type, qty: e.qty, rate: e.ratePerEgg || 0, amount: e.origAmt != null ? e.origAmt : e.amt, is_credit: !!e.isCredit });
      }
    }
    saveFingerprints(fp);

    return true;
  }

  // ── ORCHESTRATION ─────────────────────────────────────────────────
  async function syncInBackground() {
    if (syncing) return; // a sync (manual or background) is already running — never overlap
    if (!client() || !uid()) { setSyncStatus('unconfigured'); return; }
    if (!navigator.onLine) { setSyncStatus(SyncQueue.isDirty() ? 'waiting' : 'off'); return; }
    syncing = true;
    setSyncStatus('spin');
    // Captured BEFORE the push starts, not after — see SyncQueue's
    // clearIfUnchangedSince() doc comment for exactly why this ordering
    // matters (any markDirty() that happens between this line and the
    // push finishing must be able to prevent the clear below).
    const dirtyVersionAtStart = SyncQueue.dirtyVersion();
    try {
      const ok = await syncWithRetry(2);
      if (ok) { SyncQueue.clearIfUnchangedSince(dirtyVersionAtStart); setSyncStatus('on'); }
      else { setSyncStatus('error'); console.warn('[Sync] background sync failed after retries — will try again shortly.'); }
    } finally { syncing = false; }
  }

  async function manualSync() {
    if (!client() || !uid()) { toast(lang === 'hi' ? 'यह लोकल डिवाइस पर चल रहा है' : 'Running local-only on this device', 'ti'); return; }
    // Same `syncing` guard as the background sync — without this, a
    // click on "Sync Now" while the 45s periodic timer (or a just-
    // reconnected online event) happened to already be mid-sync would
    // run a second full push concurrently: same tables, same user, at
    // the same time. Not silently harmful (every write is an upsert
    // keyed by a stable id), but wasteful and exactly what was asked
    // to be prevented — one sync at a time, always.
    if (syncing) { toast(lang === 'hi' ? 'सिंक पहले से चल रहा है...' : 'Sync already in progress…', 'ti'); return; }
    syncing = true;
    setSyncStatus('spin');
    const dirtyVersionAtStart = SyncQueue.dirtyVersion();
    try {
      const ok = await syncWithRetry(4);
      if (ok) { SyncQueue.clearIfUnchangedSince(dirtyVersionAtStart); setSyncStatus('on'); toast(lang === 'hi' ? 'क्लाउड सिंक पूरा हुआ' : 'Cloud sync complete', 'ts'); }
      else { setSyncStatus('error'); toast(lang === 'hi' ? 'सिंक विफल — बाद में फिर कोशिश होगी' : 'Sync failed — will retry automatically', 'te'); }
    } finally { syncing = false; }
    renderQueueDisplay();
  }

  // Always performs at least one real sync pass on login/startup rather
  // than assuming "online + nothing locally queued = Synced" — that
  // used to mark the pill "Synced" without ever actually confirming a
  // successful round-trip to Supabase, which could hide a real auth,
  // network, or RLS configuration failure behind a falsely-green dot.
  function startBackgroundSync() {
    if (!client()) { setSyncStatus('unconfigured'); return; }
    syncInBackground();
    clearInterval(timer);
    timer = setInterval(() => { if (SyncQueue.isDirty() && navigator.onLine) syncInBackground(); }, 45000);
  }

  // Called on logout — without this, the 45s interval kept running
  // (harmlessly no-op'ing once uid()/client() go null, but still a
  // stale background timer left over from the previous account,
  // which is exactly the kind of thing worth not leaving around
  // across an account switch).
  function stopBackgroundSync() {
    clearInterval(timer);
    timer = null;
  }

  // The 'online' browser event fires when Windows/network connectivity
  // returns. This used to only act if SyncQueue.isDirty() — which
  // meant: reconnect with NOTHING pending (a very normal case — you
  // might go offline, not touch anything, then come back online) and
  // nothing ever re-checked status. The badge stayed stuck on
  // "Offline" indefinitely, until the next unrelated local change
  // happened to flip isDirty() and the next periodic tick (up to 45s
  // later) caught up. Status verification and "is there anything to
  // push" are two different questions; gating the first on the second
  // was the actual bug. Now: any genuine reconnect always attempts a
  // real sync pass (a real Supabase round-trip via syncWithRetry, not
  // just trusting navigator.onLine) when signed in, whether or not
  // anything is queued — that round-trip is what actually confirms
  // reachability and flips the badge to Synced, or to Error if
  // Supabase itself is unreachable despite the OS reporting online.
  window.addEventListener('online', () => { isOnline = true; if (AuthService.getUser()) syncInBackground(); });
  window.addEventListener('offline', () => { isOnline = false; if (AuthService.getUser()) setSyncStatus('off'); });

  // ── DELETE ALL CLOUD DATA (separate, far more destructive than a
  // local reset — deletes this account's rows from every business
  // table in Supabase). Every delete is scoped by .eq('user_id', userId)
  // so it can only ever touch this account's own rows. Runs each
  // table's delete and reports which ones failed rather than stopping
  // at the first error, so a single failed table doesn't leave the
  // user unsure whether anything happened at all.
  async function deleteAllCloudData() {
    const c = client(); const userId = uid();
    if (!c || !userId) return { ok: false, failures: ['Not signed in'] };
    // Root-cause fix (V23): this function crashed with a ReferenceError
    // on loadSyncedSet/saveSyncedSet — those were renamed to
    // loadFingerprints/saveFingerprints during the V21 incremental-sync
    // rewrite, and this ONE call site was missed. The crash happened
    // AFTER the delete loop below had already run, so the actual
    // Supabase deletes may have already succeeded — but the function
    // never returned normally, so the caller (confirmDeleteCloudAccountData
    // in backup.js) only ever saw a thrown exception and showed "Delete
    // failed — nothing was changed", which was actively misleading:
    // something may well have already changed in the cloud. This is the
    // exact, sole, traced cause of that message — not a network or RLS
    // problem.
    //
    // Also fixed here: never run concurrently with a push. Without this
    // guard, an in-flight or about-to-start background sync (the 45s
    // timer, or a reconnect event) could race this delete and push
    // records straight back into the cloud right after — or during —
    // this exact deletion, defeating the whole point of it.
    if (syncing) return { ok: false, failures: [lang === 'hi' ? 'सिंक चल रहा है — कृपया कुछ सेकंड बाद फिर कोशिश करें' : 'A sync is currently in progress — please wait a few seconds and try again.'] };
    syncing = true;
    try {
      // Deletion order matters and must respect the one real FK
      // relationship documented in supabase/SCHEMA_NOTES.md:
      // order_items.order_id AND udhar_entries.order_id both reference
      // orders.id. Both must be gone before orders itself is deleted —
      // the previous order deleted orders before udhar_entries, which
      // risks a foreign-key violation depending on the constraint's
      // ON DELETE behavior (the schema notes don't specify CASCADE, so
      // this can't be assumed safe). Every other table here has no
      // documented FK (supplier_entries/udhar_entries reference by
      // plain name text, not by id), so their relative order doesn't
      // matter — only their position relative to `orders` does.
      const tables = [
        'order_items', 'udhar_entries', 'orders', 'stock_transactions',
        'supplier_entries', 'suppliers', 'customers', 'rates', 'business_settings'
      ];
      const failures = [];
      for (const t of tables) {
        try {
          const res = await withTimeout(c.from(t).delete().eq('user_id', userId));
          if (res && res.error) failures.push(t + ': ' + res.error.message);
        } catch (e) {
          failures.push(t + ': ' + e.message);
        }
      }
      if (failures.length === 0) {
        // Only clear local sync bookkeeping once every table actually
        // succeeded — a partial failure leaves the fingerprint ledger
        // alone so a retry can still tell what may still need deleting
        // (a mismatched fingerprint isn't meaningful here either way,
        // but there is no reason to discard it on a failed attempt).
        saveFingerprints({ orders: {}, stock: {}, udhar: {}, supplier: {}, orderItems: {} });
        // Nothing meaningful is pending anymore — this is a deliberate,
        // explicit reset the user just confirmed, not a background sync
        // completing, so an unconditional clear (not the version-guarded
        // clearIfUnchangedSince) is correct here.
        if (typeof SyncQueue !== 'undefined') SyncQueue.clear();
      }
      return { ok: failures.length === 0, failures };
    } finally {
      syncing = false;
    }
  }

  return { pushAll, pullAll, syncInBackground, manualSync, startBackgroundSync, stopBackgroundSync, isReachable, deleteAllCloudData };
})();
