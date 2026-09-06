#  Anda Vyapar — Egg Business Manager

> **A professional offline-first desktop application for managing egg wholesale businesses.**

Anda Vyapar is a Windows desktop business-management application designed for egg wholesalers and traders.

It provides a complete workflow for:

-  Billing & Order Management
-  Stock Management
-  Udhar / Customer Credit
-  Supplier Purchase Ledger
-  Business Reports
-  Local Backup & Restore
-  Optional Supabase Cloud Synchronization
-  Thermal Receipt Printing
-  Keyboard-first Billing
-  Account-based Data Isolation

The application is designed around a **local-first architecture**: business operations continue to work even when there is no internet connection. Cloud synchronization is an additional recovery and cross-device capability rather than a requirement for everyday billing.

---

##  Highlights

| Capability | Description |
|---|---|
|  Offline-first | Billing and business operations continue without internet |
|  Local persistence | Business data is saved locally on the device |
|  Optional cloud sync | Supabase provides cloud backup and cross-device recovery |
|  Account isolation | Guest and signed-in accounts use separate local data |
|  Billing | Create, edit and manage customer orders |
|  Stock | Track purchases, sales and stock adjustments |
|  Udhar | Track customer credit and payments |
|  Suppliers | Maintain supplier purchase records and outstanding amounts |
|  Reports | View business activity and financial summaries |
|  Thermal printing | Native Electron printing for receipt printers |
|  Keyboard workflow | Fast Enter-based order entry |
|  Backup/Restore | Export and import complete business data |
|  Supabase Auth | Optional email/password authentication |
|  RLS isolation | Cloud records are scoped to the authenticated user |

---

#  Why Anda Vyapar?

Traditional web applications often depend heavily on a stable internet connection.

That is not ideal for a billing application used in a real business environment.

Anda Vyapar therefore follows a different principle:

> **The business should continue working even when the internet does not.**

Orders, stock changes, Udhar entries and supplier purchases are saved locally first. When cloud connectivity is available, synchronization happens in the background.

This means a temporary internet outage should not prevent the business from:

- Creating bills
- Updating stock
- Recording Udhar
- Recording supplier purchases
- Viewing previous orders
- Viewing reports
- Printing receipts
- Using the application normally

---

#  Architecture

Anda Vyapar is built as a Windows Electron desktop application.

┌─────────────────────────────────┐
│        Anda Vyapar UI           │
│                                 │
│ Rates • Orders • Stock          │
│ Udhar • Reports • Suppliers     │
│ Settings • Printing             │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│       Local Business Data       │
│                                 │
│ Account-scoped storage          │
│ Offline operation               │
│ Immediate persistence            │
└───────────────┬─────────────────┘
                │
         Background Sync
                │
                ▼
┌─────────────────────────────────┐
│            Supabase             │
│                                 │
│ Authentication                  │
│ Cloud synchronization            │
│ Cloud recovery                  │
│ Row Level Security              │
└─────────────────────────────────┘

---

## Authentication & Account Isolation

The application supports both:
Guest / Local Mode

A completely local workspace can be used without signing in.
Signed-in Accounts

Users can optionally sign in with Supabase Authentication.
Each account has its own isolated workspace:

Guest
 └── Guest local data

Account A
 └── Account A local data

Account B
 └── Account B local data

 ---

 ## Billing

The Orders section supports:

Customer name and phone
Box, Tray and Egg quantities
Multiple items per order
Cash and Udhar orders
Automatic amount calculation
Stock updates
Order editing and deletion
Order history
Receipt printing

---

## Stock & Suppliers
Stock

Stock records can be affected by supported purchases, sales and manual stock movements.

Suppliers

The Supplier Ledger supports:

Supplier records
Purchases
Box / Tray / Egg quantities
Rate per egg
Paid and credit purchases
Outstanding amounts
Supplier history
Editing supplier entries

Supplier purchases automatically update stock according to the application's business rules.

---

## Udhar

The Udhar module provides customer credit management.

It supports:

Customer-wise outstanding balances
Credit transactions
Payments
Transaction history
Editing supported entries
Account-scoped records

---

## Reports & History

The application provides business summaries and historical records for reviewing:

Orders
Revenue
Stock
Udhar
Supplier purchases
Business activity

Order History includes search, payment filters, amount filters and date-range filtering.

Calendar dates are validated properly so impossible dates such as 31 September are rejected instead of being silently converted.

---

## Backup & Restore
Export JSON

Create a local JSON backup of business data.

Import JSON

Restore business data from a previously exported backup.

Regular manual backups are recommended for important business data, even when cloud synchronization is enabled.

---

### Cloud Synchronization

Supabase provides optional cloud synchronization for authenticated accounts.

The application uses an incremental synchronization approach to avoid unnecessarily re-uploading unchanged historical records.
Local Change
     ↓
Pending Sync
     ↓
Background Synchronization
     ↓
Supabase

---

## Thermal Receipt Printing

Anda Vyapar uses Electron's native printing capabilities for compatible thermal receipt printers, including 80mm receipt workflows.

The application is designed so that a disconnected printer does not create an application-level print backlog.

Create Order
     ↓
Save Order
     ↓
Check Printer
     ↓
Printer Ready?
   ┌─────┴─────┐
  YES          NO
   ↓            ↓
 Print       Keep Order
             Saved Locally

 ---

## Data Safety

Anda Vyapar uses multiple layers of data protection:

Local-first persistence
Account-scoped local workspaces
Background synchronization
Supabase Row Level Security
JSON backup and restore
Safe cloud deletion
Protection against stale background synchronization
Atomic local save operations

The goal is to keep business operations available even when cloud connectivity is unavailable.

---

## Project Status

Anda Vyapar is built as a practical desktop business-management application with a strong focus on:

Offline reliability
Fast billing
Local data persistence
Account isolation
Cloud recovery
Thermal printing
Backup and restore
Simple business workflows

The application is intended primarily for Windows desktop use.

---

## License

This project is maintained as a private/business application.

## Anda Vyapar

Simple billing. Reliable local data. Optional cloud recovery.

Built for the everyday workflow of an egg wholesale business.

 
