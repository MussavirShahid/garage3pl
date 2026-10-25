# Zip Packers

A small, self-hosted fulfillment app for a home-garage third-party logistics
operation. Two portals, one server, no database to install.

- **Client portal** (`/client.html`): import orders from Excel, see products
  with pictures, attach a shipping label to each order, get notified when it prints.
- **Warehouse portal** (`/warehouse.html`): queue of orders to pick, each item
  shown with picture, description, garage location and quantity. Print the label
  and the order is marked printed and the client is notified automatically.

## Run it

```bash
npm install
npm start
```

On Windows, if PowerShell refuses to run `npm` ("running scripts is disabled"),
start it directly instead, which needs no script permissions:

```bash
node src/server.js
```

Open http://localhost:4000. On first run it creates:

| What | Value |
|---|---|
| Warehouse passcode | `warehouse` (set `WAREHOUSE_PASSCODE` on any start to change it) |
| Demo client code | `DEMO01` |
| Sample order sheet | http://localhost:4000/sample-orders.xlsx |

Try it: sign in as the client with `DEMO01`, import the sample sheet, upload any
PDF/image as a label on an order, then sign in to the warehouse, open the pick
list and click **Print label**. Switch back to the client tab: the order shows
**Printed** and a notification appears.

## Excel format

Any `.xlsx`, `.xls` or `.csv`. The first row is the header. Column names are
matched flexibly (case-insensitive, synonyms accepted):

| Field | Accepted headers (examples) |
|---|---|
| Order number | Order, Order Number, Order ID, Reference, PO |
| SKU | SKU, Item, Item Number, Product Code, UPC, Barcode |
| Product name | Product, Product Name, Name, Title |
| Description | Description, Desc, Details |
| Quantity | Qty, Quantity, Units |
| Location | Location, Bin, Shelf, Aisle |
| Item type | Type, Category, Item Type, Product Type |
| Ship to | Ship To, Recipient, Customer, Address |

One row = one line item. Rows with the same order number become one order.
If there is no order column, the rows are added to the product catalog only.
Products are matched by SKU within a client, so re-importing does not duplicate them.

## Adding products and orders by hand

No spreadsheet needed:

- **Products tab → + Add product**: name, SKU, item type, garage location,
  description, and a photo (upload a file or paste an image link; leave both
  empty and a picture is looked up for you).
- **Orders tab → + Create order**: pick products and quantities, enter the
  ship-to, and attach the shipping label in the same step or later from the
  orders table.

## Warehouse queue filters

The order queue can be filtered by status, by item type (from the products'
type field), and by a date range, and sorted newest or oldest first. Dates are
the local calendar day, matching what the portals display.

## Product pictures

After import, the app looks up a picture for each new product in the
background. By default it uses [Openverse](https://openverse.org), which needs
no API key but mostly has openly-licensed photos, so matches for specific retail
SKUs are hit-or-miss. Every picture is a suggestion: click a product to choose
from more results, paste a URL, or upload your own photo.

For much better product matches set one of these before `npm start`:

```bash
# Google Images via SerpAPI
SERPAPI_KEY=...
# or Google Programmable Search (image mode)
GOOGLE_CSE_KEY=...  GOOGLE_CSE_CX=...
```

## Notifications

When the warehouse prints a label the client gets an in-app notification
(badge + toast; the client page polls every 15 s). To also push it to email,
SMS or Slack, set `CLIENT_WEBHOOK_URL` and every notification is POSTed there
as JSON. Wire that URL to Zapier, Make, n8n or your own script.

## Host it online for free (to test from any browser)

GitHub Pages cannot host this app: it only serves static files, and this app
needs its Node server for imports, uploads and the API. Render's free tier
runs it as-is from this repo.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/MussavirShahid/garage3pl)

1. Click the button above (or sign up at https://render.com, then **New →
   Blueprint** and pick this repository). Render reads `render.yaml`.
2. Render asks for a `WAREHOUSE_PASSCODE`; type the one you want.
3. Wait for the first deploy (a few minutes). Your app is at
   `https://garage3pl.onrender.com` (or whatever name you chose).

What to expect on the free plan:

- The service **sleeps after 15 minutes idle** and takes 30–60 seconds to
  wake on the next visit.
- The disk is **not persistent**: orders, products, labels and uploaded photos
  reset whenever the service restarts or redeploys. Fine for testing, not for
  running the business. For real use, add a persistent disk (paid) or move the
  store to a database.
- Every push to `main` redeploys automatically.

The app reads `PORT` from the environment, so it also runs unchanged on
Railway, Fly.io or any Node host.

## Brand

The portals use the Zip Packers brand, taken from zippackers.com and the logo:

| Role | Color | Where it appears |
|---|---|---|
| Navy (primary) | `#124265` | buttons, links, "ready" status |
| Gold (highlight) | `#FFBB00` | bar under the top bar, active tab, notification edge |
| Steel blue | `#5E7FA3` | portal name pill, secondary accents |
| Text | `#333333` | body text |
| Muted text | `#7A7A7A` | hints and labels |
| Light background | `#F7F7F7` | page background |

Fonts: Roboto for text and Roboto Slab for headings, loaded from Google Fonts
with system fallbacks, so the app still works offline.

Logo: drop the logo in `public/brand/logo.png` (and optionally a 64×64
`public/brand/favicon.png`). The top bar shows it automatically; without the
file it falls back to a gold dot. The CSS variables live at the top of
`public/css/styles.css` if you ever want to retune them.

## Where data lives

- `data/store.json` — all clients, products, orders, notifications
- `uploads/labels/` — shipping labels (served only to the owning client and the warehouse)
- `uploads/products/` — uploaded product photos

Back up the `data/` and `uploads/` folders.

## Security notes

Access is a shared warehouse passcode and a per-client access code. That is
fine on a home network. If you expose this to the internet, put it behind HTTPS
and a reverse proxy with authentication (e.g. Cloudflare Access, Tailscale).

## Layout

```
src/server.js          Express app and all API routes
src/db.js              atomic JSON store
src/seed.js            first-run defaults + sample Excel
src/services/excel.js  flexible column mapping and row grouping
src/services/images.js image lookup providers
src/services/notify.js client notifications (+ optional webhook)
public/                the two portals (plain HTML/CSS/JS, no build step)
```
