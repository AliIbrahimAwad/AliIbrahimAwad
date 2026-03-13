# CRM Frontend

Standalone React + Tailwind frontend for the automotive CRM dashboard.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Notes

- This rebuild keeps the existing backend APIs untouched.
- The dashboard now reads live data from `/api/leads`, `/api/leads/:id`, and `/api/dashboard/metrics`.
- Vite proxies `/api` requests to the backend running on `http://localhost:3000` during local development.
