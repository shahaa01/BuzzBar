# BuzzBar Admin Web Panel — Phase 2 Specification

## 1. Purpose

The BuzzBar Admin Web Panel is the **operational control center** for the entire business. It is not a lightweight dashboard or a temporary CRUD layer. It must be a polished, high-trust, high-efficiency internal product that supports the daily workflows of:

* SuperAdmin
* Admin
* Employee

It must sit on top of the completed Phase 1 ( You can find in @README.md and in /docs/openapi.yaml ) backend and expose all operational power in a clear, modern, fast, and reliable interface.

The panel should feel:

* premium
* clean
* decisive
* modern
* calm under pressure
* operationally efficient

It should not look like a generic bootstrap dashboard or “AI-generated admin template.”

---

## 2. Phase 2 Goal

Build a production-grade React admin panel that fully operates BuzzBar’s Phase 1 backend and makes internal business workflows smooth, auditable, and scalable.

At the end of Phase 2, the team should be able to:

* log in as admin roles
* configure business settings
* manage catalog, variants, images, and inventory
* review and decide KYC submissions
* manage promotions
* monitor and operate orders
* inspect payment records
* handle wallet mock flows for testing
* support internal QA and operational dry-runs

This panel should be sufficient for:

* staging usage
* internal operations
* pre-launch dry runs
* launch-day administration

---

## 3. Product Principles

### 3.1 No lazy-MVP quality

The admin panel must not be a shallow wrapper over APIs. It should include:

* thoughtful workflows
* validation and safeguards
* useful tables and filters
* detail drawers/pages
* bulk actions where operationally important
* clean information hierarchy
* proper empty states, loading states, and error states

### 3.2 High-trust UI

Admins are making consequential decisions:

* approving KYC
* adjusting inventory
* confirming orders
* cancelling orders
* changing business settings

The interface should always make consequences obvious.

### 3.3 Fast operations

Common actions should take minimal clicks.
Examples:

* adjust stock quickly
* approve KYC fast
* find orders instantly
* detect stalled wallet orders
* identify low-stock products

### 3.4 Clear separation between display and action

The UI should never blur read-only information with destructive or state-changing actions.

### 3.5 Audit-friendly

Operationally meaningful actions should surface relevant metadata:

* who changed it
* when it changed
* what changed

---

## 4. Roles and Permissions

The UI must respect backend RBAC exactly.

### 4.1 SuperAdmin

Full access.
Can:

* manage settings
* manage admins/employees 
* perform all catalog/inventory/order/KYC/promo actions
* access sensitive operational views

### 4.2 Admin

High-level operational access.
Can:

* manage catalog
* manage inventory
* review KYC
* manage orders
* manage promos
* view settings
* edit only allowed settings if backend/super-admin permits

### 4.3 Employee

Operationally constrained role.
Can typically:

* review KYC if backend allows
* view orders
* assign or update order workflows if backend/super-admin allows
* inspect catalog/inventory
* perform limited actions only

### 4.4 UI behavior

Permissions should be enforced in three layers:

1. route access
2. page section visibility
3. action button visibility/disable states

The UI should never assume a permission based only on role labels. It must follow the backend contract.

---

## 5. Tech Stack

### 5.1 Frontend stack

Recommended:

* React
* TypeScript
* Vite
* React Router
* TanStack Query
* Tailwind CSS
* shadcn/ui or a similarly clean component system
* React Hook Form
* Zod
* Zustand or Context only where useful for UI state
* Axios or fetch wrapper
* Recharts for charts

### 5.2 Why this stack

This stack supports:

* speed of development
* strong typing
* scalable state/query separation
* modern and clean UI composition
* better long-term maintainability

### 5.3 Project structure

Recommended:

```txt
buzzbar-admin/
  src/
    app/
    routes/
    layouts/
    components/
      ui/
      tables/
      forms/
      status/
      feedback/
    features/
      auth/
      dashboard/
      settings/
      catalog/
      inventory/
      kyc/
      orders/
      promotions/
      payments/
      uploads/
    lib/
      api/
      auth/
      utils/
      constants/
      permissions/
    hooks/
    styles/
    types/
```

### 5.4 Architectural rule

Use **feature-first organization**. Do not dump everything into shared folders too early.

---

## 6. Design Direction

### 6.1 Visual tone

The admin panel should not be dull, corporate-grey, or template-like.
It should feel premium and intentional.

### 6.2 Color direction

Use a restrained, elegant system with subtle gradients and strong readability.

Suggested base palette:

* Background: warm charcoal / soft slate / deep neutral
* Surface: clean off-white or near-black depending on theme strategy
* Accent: refined amber, soft wine, or premium copper notes
* Success: clean green
* Warning: amber
* Danger: deep red
* Info: cool blue-grey

### 6.3 Gradient direction

Gradients should be subtle, not neon.
Examples of acceptable visual feeling:

* charcoal to graphite
* muted plum to deep slate
* warm bronze to dark neutral
* soft amber glow on key summary cards

Avoid:

* loud purple-pink startup gradients
* shiny “crypto dashboard” look
* over-saturated blues
* generic template colors

### 6.4 Typography

Use a serious, highly legible sans-serif system.

### 6.5 Layout feel

The UI should feel structured and breathable:

* generous spacing
* crisp card hierarchy
* strong tables
* restrained shadows
* rounded but not toy-like corners
* polished hover/focus states

### 6.6 Motion

Motion should be subtle and useful:

* smooth drawer transitions
* refined page transitions
* soft loading skeletons
* table row highlight feedback
* success/error feedback without visual chaos

---

## 7. Core Layout System

### 7.1 App shell

The panel should have:

* left sidebar navigation
* top header
* content area
* optional right-side contextual panel or slide-over

### 7.2 Header

Header should include:

* page title
* contextual actions
* global search trigger
* notifications/activity entry point
* user menu

### 7.3 Sidebar

Primary nav:

* Dashboard
* Orders
* KYC
* Catalog
* Inventory
* Promotions
* Payments
* Settings

Optional later:

* Admin Users
* Delivery Operations
* Analytics
* Audit Logs

### 7.4 Secondary layout tools

Use:

* tabs within feature areas
* filters row above tables
* details drawer for quick inspection
* full-page detail for complex workflows

---

## 8. Global Admin Capabilities

These patterns should exist across the panel.

### 8.1 Global search

Search should let admins quickly find:

* order number
* product name
* SKU
* user email
* KYC user
* promo code

### 8.2 Filters and saved views

Major list pages should support:

* filtering
* sorting
* pagination
* column visibility
* saved filter presets if feasible

### 8.3 Bulk actions

Where useful:

* bulk activate/deactivate products
* bulk inventory export/import later
* bulk promo deactivation later

Do not force bulk actions where unsafe.

### 8.4 Loading states

Every major page must support:

* skeleton states
* empty states
* inline refresh states
* non-blocking mutation progress indicators

### 8.5 Error handling

Errors must be human-readable and operation-aware.
Examples:

* duplicate SKU
* out of stock
* invalid transition
* KYC signed URL fetch failure
* Cloudinary misconfiguration

### 8.6 Confirmation patterns

Require confirmation for:

* cancel order
* reject KYC
* destructive catalog changes
* inventory negative adjustments
* settings changes with business impact

### 8.7 Activity and audit visibility

At minimum, important pages should surface relevant audit metadata.
Example:

* who adjusted stock
* who approved KYC
* who changed settings

---

## 9. Feature Modules

# 9.1 Authentication Module

## Purpose

Secure admin access to the panel.

## Backend dependencies

Uses Phase 1 admin auth:

* login
* refresh
* logout
* RBAC middleware

## Pages / flows

* Admin login page
* session refresh handling
* logout handling
* unauthorized page
* session expiry handling

## Requirements

* secure token storage strategy for admin panel
* protected routes
* role-aware navigation rendering
* graceful refresh failure handling
* redirect to login on expired auth

## Login page requirements

* premium and minimal design
* email
* password
* error messaging
* loading feedback

---

# 9.2 Dashboard Module

## Purpose

Provide a true operational overview, not vanity metrics.

## Dashboard contents

### 1. Top metrics

* total orders today
* orders pending review
* KYC pending count
* low stock count
* active promos count
* wallet pending count

### 2. Order health cards

* created
* KYC pending review
* confirmed
* packing
* out for delivery
* cancelled

### 3. KYC queue snapshot

* number pending
* oldest pending wait time
* quick action to review queue

### 4. Inventory alerts

* low stock variants
* zero stock variants
* recently adjusted variants

### 5. Payment health

* pending wallet orders
* failed wallet confirmations
* stale wallet cleanup stats if exposed

### 6. Quick actions

* add product
* adjust inventory
* review KYC
* create promo
* change settings

## Dashboard behavior

* should load fast
* should use summary endpoints or aggregated fetches if possible
* should not overfetch heavy tables

---

# 9.3 Orders Module

## Purpose

Operate the full order lifecycle from Phase 1 backend.

## Backend dependencies

Uses Phase 1 orders module:

* customer orders
* admin order list
* order status updates
* assign flow
* KYC_PENDING_REVIEW
* paymentMethod/paymentStatus separation
* stock reservation lifecycle

## Pages

* Orders List
* Order Detail
* Assignment workflow
* Status update workflow

## Orders List requirements

Columns should include:

* order number
* customer
* created time
* order status
* payment method
* payment status
* KYC status snapshot
* total
* delivery area
* assigned staff/delivery person

Filters:

* status
* payment method
* payment status
* KYC status
* date range
* assigned/unassigned
* service area
* search by order number/customer

Quick actions:

* open detail
* assign
* update status
* cancel order if eligible

## Order Detail page

Must include:

### 1. Overview

* order number
* timestamps
* status badges
* payment method/status
* KYC snapshot

### 2. Customer section

* user identity
* contact info if available
* address snapshot

### 3. Item snapshot section

* product image
* product name
* brand
* variant details
* unit price snapshot
* quantity
* line total

### 4. Totals section

* subtotal
* discount
* delivery fee
* total
* promo snapshot

### 5. Operational section

* current status
* allowed next transitions
* assigned operator
* notes placeholder if added later

### 6. Payment section

* COD / WALLET
* payment status
* linked payment transaction if exists

### 7. Inventory effect section

* whether stock is reserved
* whether stock committed

### 8. KYC gate section

* verified / pending / rejected snapshot
* if pending, show clearly why order is blocked from progress

## Status transition UX

The UI must not show all statuses as dropdown freeform.
It should only show **valid next actions**.

Example buttons:

* Confirm Order
* Move to Packing
* Mark Ready for Dispatch
* Mark Out for Delivery
* Mark Delivered
* Cancel Order

## Assignment UX

* assign to employee or placeholder delivery assignee
* show who assigned and when

---

# 9.4 KYC Module

## Purpose

Efficiently review and decide Phase 1 KYC submissions with full visibility into client OCR, server OCR, Cloudinary private image access, and decision reasons.

## Backend dependencies

Uses Phase 1 KYC module:

* queue
* status
* approve
* reject
* signed Cloudinary URLs
* superseded attempts filtering
* AND gate results
* 90-day tolerance logic
* never-auto-reject policy

## Pages

* KYC Queue
* KYC Review Detail

## KYC Queue requirements

Columns:

* user
* submitted time
* current status
* auto decision
* client confidence
* server confidence
* suspected issue type
* age result summary

Filters:

* pending
* rejected
* verified if needed
* date range
* low confidence
* OCR mismatch
* underage-flagged

## KYC Review Detail

Must be one of the strongest pages in the panel.

### Required sections

#### 1. Submission summary

* user
* attempt id
* submitted time
* current status
* review status

#### 2. Images

* front image
* back image
* selfie if present
* signed URLs valid for short duration
* image zoom/pan support ideally

#### 3. OCR comparison

Side-by-side display:

* client OCR text
* server OCR text
* client detected DOB
* server detected DOB
* DOB difference days
* confidence values

#### 4. Parsing outcome

* AD / BS source
* parsed canonical DOB
* parse errors
* age result
* tolerance result
* auto decision reason

#### 5. Action area

* Approve
* Reject
* required reason on reject
* confirmation modal

#### 6. Audit context

* previous attempts
* superseded attempts count
* who reviewed if already reviewed

## KYC UX principles

* must feel high-trust and deliberate
* approval/rejection should never feel casual
* underage indicators must be obvious
* superseded attempts must not clutter the queue

---

# 9.5 Catalog Module

## Purpose

Manage categories, brands, products, variants, and images using the exact model structure built in Phase 1.

## Backend dependencies

Uses Phase 1 catalog + Cloudinary upload endpoints.

## Pages

* Categories List
* Category Create/Edit
* Brands List
* Brand Create/Edit
* Products List
* Product Create/Edit
* Product Detail / Variant Management

## Catalog requirements

### Categories

Functions:

* create category
* edit category
* activate/deactivate
* set sort order
* upload image if supported later

### Brands

Functions:

* create brand
* edit brand
* upload logo/image
* activate/deactivate

### Products

Functions:

* create product
* edit product
* soft delete/deactivate
* manage slug carefully
* set brand/category
* set ABV
* description
* isActive state
* upload/manage multiple images via Cloudinary

### Variants

Functions:

* add variant
* edit variant
* deactivate variant
* manage SKU
* volumeMl
* packSize
* price
* MRP if used

## Products list page

Columns:

* image
* name
* brand
* category
* active state
* ABV
* variants count
* availability summary

Filters:

* category
* brand
* active/inactive
* low stock presence
* search by product name or slug

## Product detail page

Should include:

* product hero section
* image gallery manager
* metadata form
* variants table
* inventory summary per variant
* links to inventory adjustments

## Cloudinary upload UX

* drag/drop and click upload
* upload progress
* thumbnail preview
* reorder images if feasible
* remove image action
* safe cleanup behavior

---

# 9.6 Inventory Module

## Purpose

Operate stock precisely and confidently.

## Backend dependencies

Uses Phase 1 inventory stock + movements model.

## Pages

* Inventory Overview
* Variant Inventory Detail
* Adjustment Modal / Page
* Movement History

## Inventory Overview requirements

Columns:

* product
* variant SKU
* volume/pack
* quantity
* reserved
* available
* last updated

Filters:

* low stock
* out of stock
* brand
* category
* product search
* SKU search

## Core actions

* adjust stock
* receive stock
* inspect movement history

## Adjustment UX

Must clearly separate:

* positive adjustments
* negative adjustments
* reason entry
* actor visibility

Prevent dangerous ambiguity.

## Movement history

Show:

* movement type
* delta
* resulting quantity if available
* actor
* timestamp
* reason

## Inventory alerting UI

* low stock warning chips
* out-of-stock indicators
* reserved-heavy warning if available is low

---

# 9.7 Promotions Module

## Purpose

Manage promo rules built in Phase 1 and validate them against business rules.

## Backend dependencies

Uses promotions + promo usage rules.

## Pages

* Promotions List
* Create Promotion
* Edit Promotion
* Promotion Detail / Usage View

## Promo management requirements

Fields supported:

* code
* active/inactive
* type
* value
* min subtotal
* max discount
* startAt
* endAt
* usageLimitTotal
* usageLimitPerUser
* eligible categories
* eligible brands
* eligible products
* exclude discounted items

## Promotions List

Columns:

* code
* type
* value
* active state
* date window
* total usage cap
* per-user cap
* current usage if available

Filters:

* active/inactive
* expired
* scheduled
* code search

## Promo detail

* full rule summary
* current eligibility footprint
* usage insight if available
* deactivate action

## UX requirements

* promo math explanation preview
* validation feedback before saving
* easy distinction between flat vs percent

---

# 9.8 Payments Module

## Purpose

Inspect payment state and mock wallet flows from Phase 1.

## Backend dependencies

Uses Phase 1 payment core:

* payment transactions
* mock provider
* init/confirm
* provider abstraction
* unsupported provider handling

## Pages

* Payments List
* Payment Transaction Detail

## Payments List requirements

Columns:

* transaction id
* order number
* user
* provider
* payment method
* status
* amount
* created time

Filters:

* provider
* status
* payment method
* date range
* order search

## Payment detail

Show:

* raw normalized request snapshot
* response snapshot
* provider reference
* failure reason
* associated order
* associated user

## Mock payment support UX

Optional internal tool:

* view mock transaction lifecycle
* quickly inspect success/failure path behavior

This is mostly for internal QA and engineering support.

---

# 9.9 Settings Module

## Purpose

Control business rules from P1.1.

## Backend dependencies

Uses settings singleton.

## Pages

* Settings Overview
* Business Rules sections

## Settings sections

### 1. Night Hours

* start time
* end time
* COD restriction window explanation
* timezone shown explicitly as Asia/Kathmandu

### 2. Service Areas

* Kathmandu
* Lalitpur
* Bhaktapur
* add/remove areas if backend allows

### 3. Delivery Fee

* flat fee

### 4. Legal Age

* legalAgeMin

## UX requirements

* no silent save
* change review summary
* confirmation for sensitive settings
* audit metadata shown if possible

---

# 9.10 Admin Users / Team Management

## Purpose

Even if backend support is limited initially, the Phase 2 spec should reserve this as a proper module direction.

## If current backend does not yet support full CRUD

UI can initially provide:

* current admin profile
* role visibility
* team/role overview placeholder

## Full future requirements

* list admins/employees
* invite/create
* deactivate
* role management
* audit visibility

Do not fake unsupported functionality. If not available yet, mark as upcoming.

---

## 10. Shared UI Components Needed

### Tables

* sortable table
* filterable table
* row actions menu
* selectable rows where appropriate
* sticky headers on large tables

### Forms

* reusable field controls
* validation state handling
* dirty-state detection
* sectioned forms

### Status UI

* badges for statuses
* payment status chips
* KYC status chips
* stock alert indicators

### Feedback UI

* toasts
* banners
* empty states
* skeletons
* destructive confirmations

### Media UI

* image upload zone
* gallery grid
* signed-image preview modal

---

## 11. Engineering Requirements

### 11.1 API layer

Create typed API clients by feature.
Do not scatter raw fetch calls throughout components.

### 11.2 Query strategy

Use TanStack Query properly:

* feature-scoped query keys
* invalidation after mutation
* optimistic updates only where safe
* no excessive refetch storms

### 11.3 Form strategy

Use React Hook Form + Zod.

### 11.4 State strategy

Keep server state and UI state separate.

Use:

* TanStack Query for server state
* local component state or small store for UI state

### 11.5 Permissions architecture

Create a central permission mapping layer.
Do not hardcode role checks in random buttons.

### 11.6 Error mapping

Map backend error codes to human-friendly admin messages.

### 11.7 Accessibility

Even internal tools should be reasonably accessible:

* keyboard focus states
* proper labels
* modal focus trapping
* sufficient color contrast

### 11.8 Responsiveness

Primary target is desktop, but layout should still degrade sensibly for smaller laptop widths.

### 11.9 Performance

* table virtualization if needed later
* avoid giant page payloads
* paginated lists
* lazy-load heavier views where useful

---

## 12. Page-by-Page Completion Standard

A management page is only considered complete when it has:

1. list view
2. filters/sort/pagination
3. detail view or edit form
4. create/edit flow where applicable
5. loading/empty/error states
6. success/failure feedback
7. role-aware action controls
8. polished UX, not bare CRUD

---

## 13. Phase 2 Delivery Plan

# Phase 2A — Foundation + Design System + Auth

Build:

* admin app shell
* theme system
* auth flow
* protected routes
* layout system
* core UI components

# Phase 2B — Dashboard + Settings + KYC

Build:

* dashboard
* settings page
* KYC queue + review detail

Reason: this unlocks operational trust and verification workflow first.

# Phase 2C — Catalog + Uploads + Inventory

Build:

* categories
* brands
* products
* variants
* Cloudinary image flows
* inventory adjustments and movement history

# Phase 2D — Orders + Payments

Build:

* orders list/detail
* status transitions
* assignment
* payment transaction views

# Phase 2E — Promotions + Polish + Role Tightening

Build:

* promotions module
* role-based refinements
* saved filters / quality upgrades
* final QA polish

---

## 14. QA Expectations for Phase 2

The admin panel is complete only when the team can do these fully through UI:

* log in as admin role
* create category, brand, product, variant
* upload product images
* adjust inventory
* review and approve/reject KYC
* create and validate promos
* view and operate orders
* inspect payment transactions
* change settings safely

No direct database editing should be required for normal operations.

---

## 15. Non-Negotiables

* no generic admin template feel
* no rushed CRUD-only pages
* no missing loading/empty/error states
* no hardcoded fake data once the API exists
* no UI actions that bypass backend rules
* no visual mess or excessive gradients
* no sloppy information density
* no breaking away from Phase 1 backend contracts

---

## 16. Definition of Success

Phase 2 succeeds when BuzzBar has an admin panel that feels like a real internal product:

* elegant enough to trust
* fast enough to operate all day
* deep enough to manage the business properly
* strict enough to respect backend rules
* polished enough to support launch operations

This admin panel should be the real operational backbone of BuzzBar, not a temporary internal tool.
