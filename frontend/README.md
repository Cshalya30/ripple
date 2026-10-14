# Ripple (frontend)

See the ripple before it hits your cash. A cash-flow forecasting dashboard for small businesses, built for the "Butterfly Effect" hackathon theme.

> **All data in this app is sample data.** There is no backend and no real AI. Every number, party and chat reply is hardcoded and runs on client-side state.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173). For a production build, run `npm run build`.

## What's inside

| Route | Page |
| --- | --- |
| `/` | **The Engine**: hero, KPI strip, React Flow money-flow diagram, how it works |
| `/forecast` | 90-day cash forecast, the dip, ways to fix it, WhatsApp message composer |
| `/khata` | Customers, suppliers and tally; add forms; mocked Excel/CSV import |

The floating **Ask Ripple** assistant appears on every page. It answers from canned, keyword-matched replies; only the navigation chips do real work.

## Stack

React + Vite + TypeScript, React Router, React Flow (`@xyflow/react`), Recharts, Tailwind CSS, Framer Motion, lucide-react.

## Folder structure

```
src/
  pages/        Home, Forecast, Khata
  components/   EngineDiagram, ForecastChart, FixCards, WhatsAppComposer, AssistantWidget, modals...
  data/         typed mock data (parties, forecast, fixes, messages, assistant, upload sample)
  services/     thin service layer that returns the mock data
  types/        Party, Transaction, ForecastPoint, FixOption and friends
  context/      theme, parties, toasts
  lib/          formatting (₹ with en-IN grouping), dates, urgency, brand, theme colours
```

## Swapping in a backend later

Components never import from `src/data` directly. They call functions in `src/services/*.ts`, which are already `async` and return the same shapes a REST API would. To connect FastAPI, replace the bodies of those functions with `fetch()` calls; the pages stay untouched.

## Renaming the product

Change `APP_NAME` in `src/lib/brand.ts`. The logo, page title strings in the UI and the assistant label all read from it. Also update the `<title>` in `index.html`.

## Notes on the sample data

- Persona: an Indian textile wholesaler with 6 suppliers and 8 customers.
- Dates are generated relative to today, so "Day 34" is always 34 days from when you open the app.
- The forecast is computed from a fixed list of payment events in `src/data/forecast.ts`. Adding parties in the Khata updates the Khata, the Tally and the engine diagram, but not the forecast chart.
- The Khata never displays dates on cards or in the tally, but every add form captures them.
- Hindi and English WhatsApp messages are written out in full. Telugu, Tamil and Kannada show the English message with a notice.
- Upload accepts any `.xlsx`/`.csv` and always previews the same 24 sample rows. "Download template" gives a real CSV.
