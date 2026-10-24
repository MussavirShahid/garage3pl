# Garage 3PL

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
