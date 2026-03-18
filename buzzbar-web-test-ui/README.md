# BuzzBar Web Test UI

This is a minimal web test surface for exercising the non-admin BuzzBar backend APIs and flows.

It is intentionally not a polished customer product. The focus is:

- broad API coverage
- easy token/session inspection
- request/response visibility
- quick flow testing without touching the database

It covers:

- health and readiness
- customer auth
- `/me`
- public catalog browse
- cart
- promotion validation
- KYC submit/status
- customer orders
- customer wallet/mock payment init/confirm

It does **not** cover admin panel workflows.

## Run

```bash
npm install
npm run dev
```

Default backend base URL in the UI:

```txt
http://localhost:3000
```

## Validation

```bash
npm run typecheck
npm run build
```
