# Supabase schema — reference notes (NOT a migration)

This is documentation only. There is **no SQL migration file in this
project**, intentionally. Your Supabase project (`Anda-Vyapar`,
`rbrweaiuuyvarffckbgy`) already has a complete, correct, RLS-protected
schema in production. The app's code (`src/js/sync/syncService.js`)
targets these tables exactly as they exist — nothing here should ever
be run as SQL against the database.

## Tables (all `RLS enabled`, all policies `auth.uid() = user_id`)

| Table | Key columns |
|---|---|
| `business_settings` | `user_id` (PK), `name`, `phone`, `address`, `auto_print`, `updated_at` |
| `rates` | `user_id` (PK), `box`, `tray`, `piece`, `updated_at` |
| `customers` | `id` (PK), `user_id`, `name`, `phone`, `created_at` — unique `(user_id, name)` |
| `orders` | `id` (PK, uuid), `user_id`, `client_order_id`, `customer_name`, `customer_phone`, `is_udhar`, `total_eggs`, `total_amount`, `created_at` — unique `(user_id, client_order_id)` |
| `order_items` | `id` (PK), `order_id` → orders.id, `user_id`, `type` (box/tray/piece), `qty`, `rate`, `amount` |
| `udhar_entries` | `id` (PK), `user_id`, `customer_name`, `order_id` (nullable), `amount`, `note`, `is_payment`, `created_at` |
| `stock_transactions` | `id` (PK), `user_id`, `type` (sale/purchase/adjustment), `eggs`, `reference`, `created_at` |
| `suppliers` | `id` (PK), `user_id`, `name`, `created_at` — unique `(user_id, name)` |
| `supplier_entries` | `id` (PK), `user_id`, `supplier_name`, `type`, `qty`, `rate`, `amount`, `is_credit`, `created_at` |

## What does NOT exist (and the app must never assume otherwise)

- No `payments` table — settlements live in `udhar_entries` with `is_payment = true`.
- No `stock` table — current stock is derived from summing `stock_transactions`.
- No `profiles` table.
- No composite primary key on `orders` — it's a plain uuid `id`, with `client_order_id` as the idempotency key.
- `order_items` and `stock_transactions` and `supplier_entries` and `udhar_entries` have **no unique constraint** beyond their own `id` — `syncService.js` handles idempotency itself via a locally-persisted "already synced" key ledger, since we cannot add constraints without touching your schema.
- `supplier_entries` has no payment/settlement counterpart — money paid down against supplier credit is tracked locally only (see README limitations).

## If you ever DO want a real migration in the future

Any new migration must be written by inspecting live results from
`Supabase:list_tables` / `information_schema.columns` for this exact
project first — never invented from a spec document. That's the
mistake that caused the original `order_user_id` error.
