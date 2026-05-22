# BillSplitter — Frontend

Mobile-first web app for splitting expenses and settling debts via UPI.

## Files

| File | Purpose |
|---|---|
| `index.html` | Full SPA — all screens, styles, modals |
| `app.js` | All screen controllers, API calls, charts, demo mode |
| `api.js` | Thin fetch wrapper for the Flask REST backend |
| `vercel.json` | Vercel deployment config |

## Run locally

Just open `index.html` in any browser — no build step needed.

```bash
# Optional: serve with a local server to avoid CORS issues
npx serve .
# or
python -m http.server 3000
```

Then open `http://localhost:3000`

Click **"Try demo"** — works with zero backend.

## Connect to backend

In `index.html`, update:

```js
window.BS_API_BASE = 'https://YOUR-RAILWAY-APP.up.railway.app/api';
```

## Deploy

See `../billsplitter-backend/DEPLOY.md` for the full guide.

Quick version:
1. Push this folder to GitHub
2. Import on [vercel.com](https://vercel.com)
3. Deploy — done in 10 seconds

## Screens

- **Login / Register** — sign in or create account
- **Home** — net balance, recent activity
- **Groups** — list all groups, create new
- **Group Detail** — expenses / balances / settle tabs
- **Analytics** — donut chart, bar chart, sparkline
- **Settle Up** — optimised debt list, UPI QR payment
- **Profile** — account info, spending stats, sign out
