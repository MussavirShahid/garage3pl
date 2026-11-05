# Zip Packers

A small, self-hosted fulfillment app for a home-garage third-party logistics
operation. Two portals, one server, no database to install.

- **Client portal** (`/client.html`): create orders, see products with pictures,
  log incoming inventory, attach a shipping label to each order, get notified
  when it prints.
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

**Easiest: use the start script.** It pulls the latest code from GitHub,
installs anything new, then runs the server, so every launch is on the newest
version:

- Windows: double-click `start.cmd` (or run `.\start.cmd`)
- macOS/Linux: `bash start.sh`

This only updates when the folder is a git clone. A ZIP download has no link
to GitHub, so clone instead (see below).

Open http://localhost:4000. On first run it creates:

| What | Value |
|---|---|
| Warehouse passcode | `warehouse` (change it on the warehouse **Clients** tab, or set `WAREHOUSE_PASSCODE` on any start) |
| Demo client code | `DEMO01` |

Try it: sign in as the client with `DEMO01`, add a product, log some inventory
for it on the Inventory tab, then sign in to the warehouse and mark it received.
Back as the client, create an order for it and upload any PDF/image as its
label; in the warehouse, open the pick list and click **Print label**. Switch
back to the client tab: the order shows **Printed** and a notification appears.

## Working from another computer

GitHub holds the code only. Your live data (`data/store.json`, `uploads/labels`,
`uploads/products`) is excluded on purpose, so a fresh clone starts empty with
the demo client.

**Option A — same OneDrive account (keeps your data):** the project folder lives
in OneDrive, so once the other computer is signed in to the same account the
whole folder, data included, appears at the same path. Then:

```powershell
cd "$env:OneDriveCommercial\Documents\Claude Projects\ZipPacker 3PL Software\garage3pl"
npm install
node src/server.js
```

If `node_modules` is still syncing or looks incomplete, delete it and run
`npm install` again.

**Option B — clone from GitHub (code only):**

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
winget install --id Git.Git --exact
git clone https://github.com/MussavirShahid/garage3pl.git
cd garage3pl
npm install
node src/server.js
```

To carry your data across, copy the `data/` and `uploads/` folders from the
old machine into the clone before starting the server. Either way, commit and
push from whichever machine you edited on; starting with `start.cmd` /
`start.sh` on the other machine pulls those changes automatically. (If you
start with plain `node src/server.js`, run `git pull` first.)

Don't use GitHub's "Download ZIP" for a machine you'll keep using: a ZIP has
no git link, so it never receives updates.

## Adding products and orders

- **Products tab → + Add product**: name, SKU, item type, description, and a
  photo (upload a file or paste an image link; leave both empty and a picture
  is looked up for you). The garage location is set by the warehouse from the
  pick list.
- **Orders tab → + Create order**: pick products and quantities, enter the
  ship-to, and attach the shipping label in the same step or later from the
  orders table.
- **Delete an order**: the trash button on an order removes it, but only while
  it is still awaiting a label or ready to print. Once the warehouse has printed
  it, the button disappears and the server refuses the deletion.
- **Filter orders by date**: All / Today / Yesterday, or pick a date range.

## Inventory

Stock is tracked per product, and orders can only be created for units that are
actually available.

1. **Log a delivery.** On the client portal's **Inventory** tab, add what is on
   its way: product, quantity, expected delivery date and tracking ID. The
   warehouse can do the same for a client on its own Inventory tab (and tick
   *already received* to put it straight into stock).
2. **Warehouse receives it.** On the warehouse Inventory tab, **Mark received**
   and enter how many units arrived (fewer than expected is fine; **0** closes
   the delivery as *Not received* and leaves stock alone). The product's stock
   on hand goes up by that number and the client gets a notification.
   To correct an on-hand count later (stock take, damaged units, a receipt
   entered wrongly), click the number in the warehouse's Stock on hand table.
3. **Orders reserve stock, including stock on the way.** Units in deliveries
   not received yet count as *ordered*; units in orders not printed yet count
   as *reserved*. **Available = on hand + ordered − reserved.** Creating an
   order is refused for any product with fewer available units than requested.
   An order that needs more than what is physically on hand is created as
   **Awaiting delivery** on both portals: the client can still attach its
   label or delete it, the warehouse sees it under its own filter but cannot
   print it. When a delivery is received, waiting orders are released oldest
   first as soon as their units are on hand, and the client is notified.
4. **Printing deducts.** The first time an order is printed its units leave
   stock. Reprints never deduct again.

Both portals show on hand / ordered / reserved / available per product; the
client's Create order form greys out products with nothing available.

## Warehouse queue filters

The order queue can be filtered by status, by client, by item type (from the
products' type field), and by a date range, and sorted newest or oldest first.
Dates are the local calendar day, matching what the portals display.

## Printed labels are the client's file, unchanged

When the warehouse clicks **Print label**, the app opens the label exactly as
the client uploaded it (PDF or image). Nothing is added to it, so what prints
is what the carrier issued. Products and quantities stay on the order card's
pick list in the warehouse portal.

## Deleting a client

On the warehouse Clients tab, **Delete** removes a client together with all of
their orders, products, labels, photos and notifications. You must type the
client's name to confirm. There is no undo, so back up `data/` and `uploads/`
first if in doubt.

## Product pictures

When a product is added without a photo, the app looks up a picture for it in
the background. By default it uses [Openverse](https://openverse.org), which needs
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
needs its Node server for uploads and the API. Render's free tier
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

### Or publish it from your own PC with Cloudflare (free)

If you want to run the server on your own laptop (where your real data lives)
and reach it from anywhere, use a **Cloudflare Tunnel**. A quick tunnel gives a
temporary link in one command; a named tunnel gives a stable address on your
own domain (e.g. `app.zippackers.com`) with a valid certificate. Ready-to-run
scripts and a step-by-step guide are in [`cloudflare/`](cloudflare/README.md).
Cloudflare's serverless tiers (Pages, Workers) cannot run this app, because it
needs a Node server and a persistent disk; the tunnel approach does.

### Deploy on Namecheap shared hosting (cPanel)

Namecheap's shared plans run Node apps through cPanel's **Setup Node.js App**
(Phusion Passenger). The data and uploads stay in the app folder, which is on
persistent disk, so nothing is lost between restarts.

1. In cPanel, open **Setup Node.js App → Create Application**.
   - **Node.js version:** 22 or newer (needed for the built-in SQLite). If the
     list only offers 20, pick it and run `npm install better-sqlite3` in step 5.
   - **Application mode:** Production.
   - **Application root:** a folder *outside* `public_html`, e.g. `zippackers`.
   - **Application URL:** the domain or subdomain to serve it on.
   - **Application startup file:** `app.cjs`
2. Upload the project into that folder (File Manager, or `git clone` in the
   cPanel Terminal), without `node_modules`, `data` or `uploads`.
3. Add environment variables in the same screen: `WAREHOUSE_PASSCODE` (a strong
   one; it is hashed on first start), and optionally `SESSION_DAYS`,
   `AUTO_BACKUP_HOURS`, `CLIENT_WEBHOOK_URL`, `SERPAPI_KEY`.
4. Click **Run NPM Install**, then **Restart**. Open the application URL.
5. If you moved data from your laptop, copy `data/` and `uploads/` into the
   application root (an old `data/store.json` is imported automatically on the
   first start) and restart.
6. Make sure the domain has a valid SSL certificate (Namecheap's AutoSSL in
   cPanel). The session cookie is only sent over HTTPS when the site runs on
   HTTPS, which is what you want.

Backups: schedule a daily cron job in cPanel that runs
`cd ~/zippackers && node src/backup.js`, and download `data/backups/` and
`uploads/` now and then. Updates: pull the new code (or re-upload), click
**Run NPM Install** if `package.json` changed, then **Restart**.

## Brand

The portals use the Zip Packers brand, taken from zippackers.com and the logo:

| Role | Color | Where it appears |
|---|---|---|
| Yellow (brand) | `#FFD400` | top bar, the key action button (Print label), active tab indicator, focus ring |
| Navy (support) | `#124265` | primary buttons, links, order numbers, "ready" status, stripe under the top bar |
| Steel blue | `#5E7FA3` | portal name pill, secondary accents |
| Text | `#333333` | body text |
| Muted text | `#7A7A7A` | hints and labels |
| Light background | `#F7F7F7` | page background |

The look follows apple.com's product pages: light-gray canvas, large white
rounded cards, big centered headlines, pill buttons. Font: Inter from Google
Fonts with system fallbacks (SF Pro on Apple devices, Segoe UI on Windows), so
the app still works offline. Details in `design-system/zip-packers/MASTER.md`.

Logo: drop the logo in `public/brand/logo.png` (and optionally a 64×64
`public/brand/favicon.png`). The top bar shows it automatically; without the
file it falls back to a gold dot. The CSS variables live at the top of
`public/css/styles.css` if you ever want to retune them.

## Database and backups

Records live in a **SQLite** database, `data/zip.sqlite`: a real relational
database (tables, indexes, foreign keys, transactions) in a single file, with
nothing to install or administer. It uses the SQLite built into Node 22.13+ and
Node 24. On an older Node, run `npm install better-sqlite3` once and the same
code uses that instead.

- `data/zip.sqlite` — clients, products, orders, deliveries, notifications, sessions, settings
- `data/backups/` — automatic daily copies of the database (newest 14 kept; `AUTO_BACKUP_HOURS=0` disables)
- `uploads/labels/` — shipping labels (served only to the owning client and the warehouse)
- `uploads/products/` — uploaded product photos

**Backups.** `npm run backup` writes a consistent copy to `data/backups/` at
any time; the server also does this once a day by itself. A complete backup is
`data/` plus `uploads/`. To restore, stop the server, copy a backup file over
`data/zip.sqlite`, and start again. The server checks the file's integrity on
every start and refuses to run on a damaged one.

**Upgrading from the old JSON store.** If `data/store.json` is present on first
start, everything in it is imported once and the file is renamed to
`store.json.migrated-<date>`. Nothing is lost; delete the old file when you are
satisfied.

Tables: `clients`, `products` (with `stock`), `orders`, `order_items`,
`inbound` (incoming deliveries), `notifications`, `sessions`, `settings`.
The data layer is plain SQL, so moving to MySQL or Postgres later is a
contained change.

## Security

Built for exposure on the public internet:

- **Sign-in sessions.** Signing in sets an `HttpOnly`, `SameSite=Lax` cookie
  (`Secure` over HTTPS). Nothing secret is kept in the browser's storage or in
  URLs. Sessions last 30 days of inactivity (`SESSION_DAYS`) and are stored as
  a hash, so the database never holds a usable token. Sign out ends the session.
- **Warehouse passcode** is stored hashed (scrypt) and can be changed on the
  warehouse Clients tab; doing so signs out every other warehouse device.
  Client access codes are 8 characters from a 32-letter alphabet.
- **Brute force** is slowed by a per-IP limit of 20 failed sign-ins per
  15 minutes.
- **Cross-site requests** are blocked twice over: the cookie is `SameSite=Lax`,
  and every state-changing API call must carry a header that cross-site forms
  cannot set.
- **Browser hardening**: a strict Content Security Policy (scripts only from
  this origin, no inline scripts), `X-Frame-Options: DENY`, `nosniff`, a
  referrer policy, and HSTS over HTTPS.
- **Uploads** are limited to PDF/PNG/JPG/WebP labels (15 MB) and
  PNG/JPG/WebP/GIF photos (10 MB), stored under random names, and served with
  the stored type.
- **Inputs** are trimmed and length-capped; all SQL is parameterised; error
  responses never include stack traces.

Behind a host's proxy (cPanel/Passenger, Cloudflare, Render) the app trusts one
proxy hop for the client IP and HTTPS flag (`TRUST_PROXY=1`, the default).
Set `TRUST_PROXY=false` only if Node is reached directly.

Still your job: keep the host's SSL certificate valid, choose a strong
warehouse passcode, and keep `data/` and `uploads/` out of any public web
folder.

## Future ideas (parked)

Not built yet; noted so they are not forgotten.

- **Tracking numbers as links.** Detect the carrier from the number's format
  (UPS `1Z…`, FedEx 12–15 digits, USPS 20–22 digits) and make the tracking
  ID on both portals' Incoming deliveries lists a one-click link to the
  carrier's tracking page.
- **Search deliveries.** A search box on both Incoming deliveries lists to
  filter by tracking ID, product or client.
- **Multi-page label PDFs.** Stamp or split multi-page labels and assign each
  page to an order (auto-match by ship-to text, manual fallback).

## Layout

```
app.cjs                startup file for cPanel / Passenger (loads src/server.js)
src/server.js          Express app and all API routes
src/db.js              SQLite data layer: schema, migrations, JSON import, backups
src/auth.js            sessions, sign-in rate limit, security headers
src/passwords.js       scrypt hashing for the warehouse passcode
src/seed.js            first-run defaults (passcode, demo client)
src/backup.js          `npm run backup`
src/services/images.js image lookup providers
src/services/notify.js client notifications (+ optional webhook)
public/                the two portals (plain HTML/CSS/JS, no build step)
```
