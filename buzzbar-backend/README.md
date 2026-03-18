# BuzzBar

## Developer Runbook (Backend)

### Setup

```bash
git clone <repo>
cd buzzbar-backend
npm install
cp .env.example .env
npm run dev
```

Required for `npm run dev` / `npm start`:
- `MONGO_URI`
- JWT secrets (`ADMIN_JWT_*`, `USER_JWT_*`)
- Cloudinary credentials (`CLOUDINARY_URL` **or** `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET`)

### Verification

```bash
npm run typecheck
npm test
npm run lint
```

### API Docs

- OpenAPI spec: `docs/openapi.yaml`

**BuzzBar** is a liquor ordering and delivery platform focused on making it extremely easy to get drinks for home gatherings, parties, and casual nights. The platform allows users to browse and order alcoholic beverages and party essentials with a smooth, fast ordering experience.

BuzzBar will initially operate **only within Kathmandu Valley**, with plans to scale later.

---

# 1. Product Overview

## Core Idea

BuzzBar exists for one simple moment:

> *“When I want to drink or party, BuzzBar is the easiest way to get drinks, anytime.”*

The platform is built for:

* Home drinking
* House parties
* Office gatherings
* Late night orders
* Social drinking occasions
* Spontaneous Drink Plans

BuzzBar focuses on **convenience, speed, and choice**.

---

# 2. Market Scope

## Launch Location

Kathmandu Valley

Coverage areas:

* Kathmandu
* Lalitpur
* Bhaktapur

Expansion will be considered after validating operations and demand.

---

# 3. Product Offering

BuzzBar will offer:

### Alcohol

* Beer
* Whiskey
* Vodka
* Rum
* Wine
* Other popular liquors

Products will include:

* Budget options
* Mid-range brands
* Premium liquors

### Party Essentials (Add-ons)

Items commonly needed with drinks:

* Coke
* Sprite
* Soda
* Ice packs
* Lemons
* Disposable glasses
* Snacks consumed with drinks

The goal is to let users **get everything for a drinking session in one order**.

---

# 4. Delivery & Operations

Delivery will initially be limited to **Kathmandu Valley only**.

Operational design:

* Delivery system will be finalized **after platform development**
* Delivery partners and time commitments will be decided later
* The platform will support **24/7 ordering**

Delivery promises:

* Fast delivery
* Reliable availability
* Night ordering support

---

# 5. Payments

Phase 1 supported payments:

* Cash on Delivery (COD)
* Online wallet payments

Supported wallets:

* eSewa
* Khalti

Special rule:

Night orders WILL require **mandatory online payment** to reduce risk.

---

# 6. Promotions

BuzzBar will support:

* Promo codes
* Limited offers
* Retention discounts

These will help drive early user adoption.

---

# 7. Brand Identity

BuzzBar should feel:

* Energetic
* Youthful
* Playful
* Modern
* Accessible premium

The brand should **intimidating**.

Avoid AI-ish color palattes:

* Gold themes
* Purple tones
* Neon tech-style gradients
* "AI looking" design

The visual identity should feel clean, vibrant, playfulness, youthful and social which should increase good stimulus in brain

---

# 8. Brand Positioning

## Tagline Concepts

Possible taglines:

* *BuzzBar – Drinks at your door, anytime.*
* *BuzzBar – Party starts at your doorstep.*
* *BuzzBar – Your 24/7 drinks partner.*

---

# 9. Brand Pillars

BuzzBar is built around five core pillars.

### Instant Drinks

Fast and reliable alcohol access anytime.

### Party Convenience

Everything needed for a night together.

### Choice for Every Budget

From affordable beers to premium whiskey.

### Genuine Pricing

Pricing always lesser than the offline market price, NO RIPPING OFF!

### Effortless Ordering

A simple, frictionless buying experience.

### Safe & Responsible Drinking

Strict age verification and responsible delivery.

---

# 10. Age Verification

BuzzBar requires **age verification once per user account**.

Verification occurs **during the first order**.

Users must upload either:

* Citizenship Card
* Passport

---

## Age Verification Flow

1. Start Age Verification Screen

2. Capture ID Image
   User captures an image of the document with a guided frame.

3. Image Quality Check

If the image is not readable:

* Show error reason
* Ask user to retake the image

4. OCR Processing

Using text recognition to read the document.

Tools:

* ML Kit Text Recognition
* Flutter image processing libraries
* Backend local OCR via `tesseract` CLI with `eng+nep` language data when `KYC_OCR_MODE=real`

Local backend OCR notes:

* install `tesseract`
* install language data for:
  * `eng`
  * `nep`
* recommended env:
  * `KYC_OCR_LANGS=eng+nep`
  * `KYC_OCR_PSM=6`
  * `KYC_OCR_TIMEOUT_MS=5000`

5. Date Extraction

Extract **Date of Birth** from the document.

Possible formats:

* AD (Gregorian)
* BS (Bikram Sambat)

6. Date Conversion

If BS format detected:

Convert to AD.

7. Age Calculation

Compute age.

Requirement:

User must be **18+ years old**.

8. Verification Result

Store:

* Verification result
* ID image
* Timestamp

9. Manual Review (Fallback)

If automatic verification fails:

Admin/Manager manually verifies the document.

10. Order Permission

User can place orders only after successful verification.

---

# 11. Platform Components

BuzzBar will consist of three main platforms.

### 1. Mobile App

Technology:

Flutter

Approach:

Reuse **Divaa's (Exisitng Clothing E-commerce flutter APP) Flutter UI codebase** and modify it to match BuzzBar design and flows.

---

### 2. Web App

Features:

* Product browsing
* Ordering
* Responsive mobile-first design

Potential future use:

* B2B access

---

### 3. Admin / Backoffice

Admin Roles
BuzzBar will implement Role-Based Access Control (RBAC) with three primary roles.
1. SuperAdmin
Highest level of system access.
Capabilities:
Create and manage Admin accounts
Create and manage Employee accounts
Full access to all system modules
System configuration
Product and inventory control
Promotion management
Access to analytics
Access to age verification reviews
Override permissions if needed
SuperAdmin is typically the business owner AND core technical operator.

2. Admin
Admin manages business operations.
Capabilities:
Product management
Category management
Inventory management
Order management
Delivery assignment
Promotions management
Age verification manual review
View analytics dashboard
Restrictions:
Cannot create or delete SuperAdmins
Cannot change system-level configurations

3. Employee
Employees are operations staff handling daily tasks.
Capabilities:
View orders
Update order status
Verify age documents manually
View inventory
Add Products
Add Categories
View Products
View existing promotions
Restrictions:
Cannot modify products
Cannot modify promotions
Cannot access analytics
Cannot create admin users

# 13. Backend Architecture

Backend will be built using **MERN stack**.

Stack:

* MongoDB
* Express.js
* Node.js
* React (for dashboards and pannels and web-app)

Backend responsibilities:

* Authentication
* User management
* Age verification
* Product catalog
* Inventory management
* Order processing
* Payment integration
* Delivery logic
* Promotions
* Analytics

Both **Flutter mobile app** and **web app** will use the same backend APIs.

---

# 14. Backend Structure (Initial)

Suggested folder structure:

```
buzzbar-backend/

src/
  config/
  controllers/
  middleware/
  models/
  routes/
  services/
  utils/
  jobs/
  validations/

server.js
app.js
```

Key modules:

* Auth
* Users
* Products
* Categories
* Orders
* Payments
* Promotions
* Delivery
* AgeVerification
* Inventory

---

# 15. Core System Entities

Main data models will include:

User
Product
Category
Inventory
Order
OrderItem
Payment
Promotion
AgeVerification
Delivery
AdminUser

---

# 16. Development Philosophy

BuzzBar backend should prioritize:

* Clean modular architecture
* Clear service separation
* API-first design
* Scalability for night traffic spikes
* Strong validation and security

The backend must support both:

* Mobile app
* Web application

with a **single unified API layer**.

---

# 17. Development Status

Current phase:

Planning and architecture setup.

Next steps:

1. Backend project initialization
2. Authentication system
3. User model
4. Product catalog
5. Order system
6. Age verification module
7. Payment integration
8. Admin panel
9. Delivery system

---

# 18. Vision

BuzzBar aims to become **the easiest and fastest way to get drinks** for any occasion.

The platform should feel:

* Effortless
* Genuine Pricing
* Social
* Fast
* Reliable

BuzzBar should become the **default app people open when they think about drinks.**
