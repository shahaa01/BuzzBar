# BuzzBar Admin Panel (Phase 2A)

Production-grade foundation for BuzzBar’s internal admin panel (React + Vite + TypeScript).

## Setup

```bash
cd buzzbar-admin
npm install
cp .env.example .env
npm run dev
```

Required env:
- `VITE_API_BASE_URL` (example: `http://localhost:3000`)

Backend must be running and reachable at `VITE_API_BASE_URL`.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
```

## Auth behavior (important)
- Refresh token is stored in `localStorage` (`bb_admin_refresh_token`).
- Access token is kept in memory only.
- Role + identity truth always comes from the **decoded access token**.
- Logout sends:
  - access token via `Authorization: Bearer <accessToken>`
  - refresh token via `x-refresh-token: <refreshToken>` (preferred) + body fallback

