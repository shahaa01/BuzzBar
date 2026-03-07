BuzzBar Backend — Dev Phase 1 Split into Mini‑Phases (Sequential)
Summary
Dev Phase 1 is an internal milestone (not public launch). To make it achievable, we’ll deliver it as P1.0 → P1.8 mini‑phases where each phase:

produces a runnable backend (docker-compose up works),
exposes a stable set of endpoints,
includes minimum tests for what it adds,
is safe to build on for the next phase.
Repo location: ../buzzbar-backend (sibling to BuzzBarWeb/).

P1.0 — Foundation + Local Runtime
Goal: skeleton service that runs locally and is ready for modules.

Deliverables

Node/Express/TypeScript scaffold, env loader, centralized error handler, request-id + logging, CORS allowlist, rate limits, payload limits.
Mongo connection + graceful startup/shutdown.
docker-compose.yml (Mongo + API), Dockerfile (API), .env.example.
Endpoints

GET /health (always 200)
GET /ready (200 only if Mongo connected)
Tests

Health/ready basic tests.
Exit criteria

Fresh machine can run API + Mongo locally with one command.
P1.1 — Settings + Admin Bootstrap (RBAC base)
Goal: make “night hours” and operational settings real and configurable by SuperAdmin.

Deliverables

Settings singleton model (nightHours, serviceAreas, deliveryFeeFlat, legalAgeMin, timezone=Asia/Kathmandu).
AdminUser model + bootstrap SuperAdmin (creates one if none exists, from env vars).
Admin auth (email/password) + JWT access/refresh for admins.
RBAC middleware for superadmin|admin|employee.
Admin audit log foundation (record who changed settings).
Endpoints

POST /api/v1/admin/auth/login|refresh|logout
GET /api/v1/admin/settings (admin+)
PUT /api/v1/admin/settings (superadmin only)
Tests

SuperAdmin bootstrap created once.
RBAC blocks employee from settings update.
Exit criteria

SuperAdmin can log in and set night hours.
P1.2 — Customer Auth (Email + Google + Apple)
Goal: establish customer identity system compatible with your current Flutter auth set.

Deliverables

User model (email/passwordHash, authProviders, phone, addresses[], kyc status placeholder).
Customer auth: signup/login/logout/refresh with refresh rotation.
Google ID token verification endpoint.
Apple identity token verification endpoint (nonce support).
Endpoints

POST /api/v1/auth/signup|login|refresh|logout
POST /api/v1/auth/google
POST /api/v1/auth/apple
GET /api/v1/me, PUT /api/v1/me
Tests

Refresh rotation works; revoked refresh token fails.
Google/Apple login upserts user.
Exit criteria

Customers can authenticate via all 3 methods and get stable GET /me.
P1.3 — Catalog (Admin CRUD + Public Browse)
Goal: get products/categories/variants/stock into the system.

Deliverables

Category, Product (+ variants/stock), slugging, indexes.
Upload storage abstraction (local dev driver first; S3 driver stubbed but wired).
Admin CRUD for catalog + stock adjustments.
Public browse + filters for customer apps.
Endpoints

Public: GET /api/v1/categories, GET /api/v1/products, GET /api/v1/products/:id
Admin: POST/PUT/DELETE /api/v1/admin/categories/*, POST/PUT/DELETE /api/v1/admin/products/*
Tests

Catalog filters (category/price/abv/volume + pagination).
Admin creates product with variants; public can fetch it.
Exit criteria

Admin can populate catalog; customer can browse it.
P1.4 — KYC (OCR + DOB parse AD/BS + Admin Override)
Goal: enforce “18+ verified once per account” at the backend level.

Deliverables

KYC submit pipeline: multipart upload → image preprocess (sharp) → OCR (Tesseract) → DOB extraction:
AD formats
BS detection + conversion via nepali-date-converter
KYC status persisted on user: not_started|pending|verified|rejected, with audit fields.
Admin KYC review APIs: list pending/rejected, view images + OCR text, approve/reject override.
Endpoints

Customer: POST /api/v1/kyc/submit, GET /api/v1/kyc/status
Admin: GET /api/v1/admin/kyc/queue, GET /api/v1/admin/kyc/:userId, POST /api/v1/admin/kyc/:userId/approve|reject
Tests

KYC verified blocks/unblocks ordering (use fixtures or deterministic test doubles for OCR).
Admin override changes status + audit log.
Exit criteria

Backend can deterministically gate orders based on KYC status.
P1.5 (Perfect)
Cart + Promotions (Deterministic Pricing + Reservation-Ready)
Goal

Deliver a fully deterministic cart and promo validation layer that both Flutter and Web can rely on, and that Orders (P1.6) can build on without refactoring.

1) Key decisions locked (no ambiguity)
1.1 Cart pricing rule (recommended)

Cart totals are computed from current Variant price at read-time, not frozen at add-time.

Why:

avoids stale prices in cart

lets Admin change prices and cart reflects reality

the Order (P1.6) is where you freeze snapshots.

So:

Cart stores variantId + qty

Pricing is derived from Variant at runtime

1.2 Inventory rule in P1.5

Cart does not reserve inventory.
But cart endpoints must validate availability using:

available = quantity - reserved

Cart add/update should:

prevent qty > available

return a clear error code if insufficient stock

(Reservation is a P1.6 responsibility.)

1.3 Promo rule in P1.5

Promo validation is read-only: it calculates eligibility and expected discount for a cart total.

No redemption, no locking usage, no decrementing counters yet.
(Real usage locking happens in P1.6 at order creation.)

2) Data models
2.1 Cart (per user, singleton)

userId (unique)

items: CartItem[]

appliedPromoCode?: string (optional convenience)

updatedAt

CartItem

variantId

qty (int, >=1)

addedAt

Indexes:

unique userId

2.2 Promotion

Fields (complete enough to avoid redesign):

code (unique, uppercase normalized)

type: "PERCENT" | "FLAT"

value (percent 0–100 or flat amount)

startAt, endAt

minSubtotal (optional)

maxDiscount (optional, important for percent promos)

usageLimitTotal (optional) — total cap

usageLimitPerUser (optional) — per user cap

isActive

Future-ready (optional now but perfect):

eligibleCategoryIds?: []

eligibleBrandIds?: []

eligibleProductIds?: []

excludeDiscountedItems?: boolean

2.3 PromoUsage (for validation correctness)

To support “usage caps” properly without guessing later, define a small usage tracker:

promoId

userId

usedCount (int)

updatedAt

And optionally:

promoId totalUsedCount can be tracked in Promotion or via aggregation later

Note: In P1.5, you read these counts to decide eligibility; you don’t “spend” usage yet.

3) API Endpoints (final)
Cart (auth required)

GET /api/v1/cart

returns:

items (variantId, qty)

expanded item details (name, images, volumeMl, packSize, price)

computed subtotal

availabilityWarnings[] (if an item is now out of stock)

POST /api/v1/cart/items

body: { variantId, qty }

behavior:

adds item or increments qty

validates qty <= available

returns updated cart summary

PATCH /api/v1/cart/items/:variantId

body: { qty }

if qty == 0, remove item (or require DELETE; your choice, but be consistent)

DELETE /api/v1/cart/items/:variantId

POST /api/v1/cart/clear

Promotions (auth required recommended, because per-user limits)

POST /api/v1/promotions/validate

input options:

{ code } and it validates against current cart

or { code, items[] } for stateless validation (optional)

returns:

isValid

reasons[] (e.g., EXPIRED, BEFORE_START, MIN_SUBTOTAL_NOT_MET, USAGE_LIMIT_REACHED, NOT_APPLICABLE_ITEMS)

discountAmount

maxDiscountApplied?: boolean

newTotal (subtotal - discount + deliveryFee? → for P1.5 keep deliveryFee out; that’s P1.6)

4) Deterministic pricing contract (very important)

Define these computed fields and keep them consistent:

subtotal = sum(item.qty * variant.price)

discount = promo calculation (if validated)

No delivery fee in P1.5 (unless you already want to include settings deliveryFeeFlat; if you do, include it everywhere consistently)

Rounding rule

Store currency in integer (NPR rupees) and ensure discount math rounds deterministically (floor/round — choose one and standardize).

5) Error codes (make client integration clean)

Cart endpoints should return clear, stable errors:

VARIANT_NOT_FOUND

VARIANT_INACTIVE

OUT_OF_STOCK

INSUFFICIENT_STOCK

INVALID_QTY

Promotions validate should return reasons (not just “false”):

PROMO_NOT_FOUND

PROMO_INACTIVE

PROMO_EXPIRED

PROMO_NOT_STARTED

MIN_SUBTOTAL_NOT_MET

USAGE_LIMIT_TOTAL_REACHED

USAGE_LIMIT_PER_USER_REACHED

NOT_APPLICABLE

6) Tests (must-pass for “perfect P1.5”)
Cart tests

add item (in stock) → subtotal correct

update qty → subtotal correct

remove item → totals correct

cannot set qty above available (uses quantity-reserved)

cart returns expanded variant details reliably

Promo tests

expired promo rejected with reason

not started promo rejected with reason

minSubtotal gate works

percent promo respects maxDiscount

per-user usage limit respected (reads PromoUsage)

total usage limit respected (reads counts)

Determinism test

same cart + same prices + same promo → same totals every run

7) Exit criteria

P1.5 is complete when:

Cart totals are always deterministic

Stock validation prevents impossible carts

Promo validation returns correct discount + reasons

All behaviors are test-covered and stable

P1.6 — Orders (Business Rules + Night COD Enforcement)
Goal: create orders with correct gating and state machine (without real payments yet).

P1.4 does not implement order logic, but defines how orders will interact with KYC.

Order behavior in P1.6 will follow:

if kycStatus == verified
    allow normal order flow

if kycStatus == pending
    allow order creation
    restrict further processing until admin review

if kycStatus == rejected
    block order creation

Deliverables

Order model + order number generation + status transitions.
Order creation:
KYC must be verified
address must be within serviceAreas
night-hours COD rejected (Settings-driven, Asia/Kathmandu)
stock checks
price snapshots + totals (subtotal/discount/deliveryFee/total)
Customer order list/detail.
Admin order list + status update + assign delivery.
Endpoints

Customer: POST /api/v1/orders, GET /api/v1/orders, GET /api/v1/orders/:id
Admin: GET /api/v1/admin/orders, PATCH /api/v1/admin/orders/:id/status, PATCH /api/v1/admin/orders/:id/assign
Tests

Order blocked if KYC not verified.
COD rejected during configured night window.
Stock prevents oversell.
Exit criteria

Orders work end-to-end for COD in allowed hours (payment handling minimal).
P1.7 — Payments (First Mock, Then Real eSewa + Khalti)
Goal: integrate wallets safely without blocking the whole backend milestone.

P1.7a — Payment provider interface + Mock provider
Deliverables

Payment provider interface: init(order), confirm(callbackPayload).
Mock provider for local testing (instant success/failure toggles).
Exit criteria

Wallet flow can be tested locally without real credentials.
P1.7b — Real eSewa + Khalti integrations
Deliverables

eSewa init/confirm + callback handling; signature/verification per provider spec.
Khalti init/confirm + callback/webhook handling.
PaymentTransaction audit storage.
Order transitions:
wallet init ⇒ payment_pending
confirm success ⇒ paid + order confirmed
confirm fail ⇒ failed + order rejected/cancelled (explicit rule)
Endpoints

POST /api/v1/payments/esewa/init|confirm
POST /api/v1/payments/khalti/init|confirm
Provider callbacks (public) as required: /api/v1/payments/*/callback|webhook
Tests

Mock provider: success/failure.
Real provider: signature validation unit tests + simulated callback payload tests.
Exit criteria

Wallet orders can be paid and confirmed reliably; audit trail exists.
P1.8 — Hardening Pass (Docs + Ops + Minimal Load Safety)
Goal: make Phase 1 “internal-perfect enough” to iterate safely.

Deliverables

OpenAPI spec (or Postman collection) for /api/v1.
Index review (unique keys, common query indexes).
Background job: cleanup stale payment_pending orders.
Security checks: brute-force protections, auth rate limits, file upload limits, MIME checks.
CI command set: test, typecheck, lint (non-mutating in CI).
Exit criteria

A new engineer can run + test the backend from docs alone; QA can validate flows.
Phase sequencing rules (how we’ll execute)
No phase starts until previous phase’s exit criteria + tests pass.
API shapes introduced in earlier phases do not break in later phases; additive changes only (or versioned).
Payments are isolated behind a provider interface so the rest of the backend remains testable without real gateways.
Assumptions (carried from your decisions)
Dev Phase 1 includes COD + eSewa + Khalti (not “COD only”).
Night hours are chosen by SuperAdmin and evaluated in Kathmandu.
Admin UI is not part of Dev Phase 1; only Admin APIs.