/* ============================================================
   DETERMINISTIC UUIDs (RFC 4122 v5 — name-based, SHA-1)
   Used so a locally-created record (an order item, a udhar entry,
   a stock log line, a supplier purchase) always produces the SAME
   cloud row id no matter how many times it's synced. Combined with
   `.upsert(..., { onConflict: 'id' })` in syncService.js, this makes
   every push idempotent at the database level — a retry, an app
   restart mid-sync, or a partial failure can never create a second
   copy of the same local record, even though these tables have no
   unique constraint besides their own primary key (which is exactly
   why this exists, instead of relying on the local synced-keys ledger
   alone for correctness).
   ============================================================ */
const AndaUUID = (function () {
  // Fixed namespace for this application (any valid UUID works — it
  // only has to be constant across runs, which it is).
  const NAMESPACE = '6f2a9b8e-6c2b-4c4a-9a7b-2f0e2f1a9d3c';

  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    return bytes;
  }
  function bytesToHex(bytes) {
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // name-based UUID v5: SHA-1(namespace_bytes + name_bytes), then set
  // version/variant bits per RFC 4122.
  async function v5(name, namespace) {
    namespace = namespace || NAMESPACE;
    const nsBytes = hexToBytes(namespace.replace(/-/g, ''));
    const nameBytes = new TextEncoder().encode(String(name));
    const combined = new Uint8Array(nsBytes.length + nameBytes.length);
    combined.set(nsBytes, 0);
    combined.set(nameBytes, nsBytes.length);

    const hashBuf = await crypto.subtle.digest('SHA-1', combined);
    const hash = new Uint8Array(hashBuf).slice(0, 16);

    hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
    hash[8] = (hash[8] & 0x3f) | 0x80; // variant

    const hex = bytesToHex(hash);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return { v5 };
})();
