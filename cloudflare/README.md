# Host Zip Packers on Cloudflare (free)

Zip Packers is a Node server that keeps its data in files on disk
(`data/store.json`, uploaded labels and photos under `uploads/`). Cloudflare's
free *serverless* products do not fit it:

- **Cloudflare Pages** serves static files only, so it cannot run the API,
  Excel import or uploads.
- **Cloudflare Workers** have no persistent filesystem and do not run Express
  or Multer, so the JSON store and file uploads would have to be rewritten onto
  KV/R2/D1. That is a different app.

What *does* fit, for free, is a **Cloudflare Tunnel**: you run the normal Node
server on a computer you control, and Cloudflare publishes it on the internet
over HTTPS. Your data stays on your machine. This is the setup to use.

Two ways to do it:

- **Quick tunnel** — one command, a random `trycloudflare.com` URL, nothing to
  configure. Great for showing someone right now. The URL changes every time.
- **Named tunnel** — a stable address on your own domain (for example
  `app.zippackers.com`) with a valid certificate. A little setup once, then it
  is permanent. Use this for real use.

> Run this on the computer that holds your real data (your laptop). A cloud
> session or a throwaway container starts with an empty database, so a tunnel
> from there would publish an empty app.

---

## 1. Install cloudflared

- **Windows:** `winget install --id Cloudflare.cloudflared`
- **macOS:** `brew install cloudflared`
- **Linux:** packages at <https://pkg.cloudflare.com/>, or download the binary
  from <https://github.com/cloudflare/cloudflared/releases>

Check it: `cloudflared --version`

---

## 2. Quick tunnel (temporary URL, zero config)

From the project folder:

- **Windows:** double-click `cloudflare\quick-tunnel.cmd`
- **macOS/Linux:** `bash cloudflare/quick-tunnel.sh`

Each script starts the server on `PORT` (default 4000) and opens the tunnel.
cloudflared prints a line like:

```
https://random-words-here.trycloudflare.com
```

Open or share that link. Press `Ctrl+C` to close the tunnel. The next run gives
a different URL.

Prefer to do it by hand? In one terminal run `node src/server.js`, in another
run `cloudflared tunnel --url http://localhost:4000`.

---

## 3. Named tunnel (stable address on your domain)

This gives you something like `https://app.zippackers.com` that never changes
and carries a real Cloudflare certificate, so the padlock is green. It also
removes the expired-certificate problem on `zippackers.com`, because Cloudflare
terminates TLS for you.

**One-time domain step.** Your domain's DNS must be on Cloudflare (free plan):
add the site at <https://dash.cloudflare.com>, then change the nameservers at
your registrar to the two Cloudflare gives you. This is only needed once.

Then, on the computer that will run the server:

1. **Log in** (opens a browser to pick your domain):
   ```
   cloudflared tunnel login
   ```
2. **Create the tunnel** (any name; `zippackers` here). This prints a UUID and
   writes a credentials `.json` into your `.cloudflared` folder:
   ```
   cloudflared tunnel create zippackers
   ```
3. **Write the config.** Copy `cloudflare/config.example.yml` to your
   `.cloudflared` folder as `config.yml` and fill in the tunnel UUID and the
   path to the credentials file from step 2. The folder is
   `C:\Users\<you>\.cloudflared\` on Windows, `~/.cloudflared/` on macOS/Linux.
4. **Point the hostname at the tunnel** (creates the DNS record for you):
   ```
   cloudflared tunnel route dns zippackers app.zippackers.com
   ```
5. **Start the app, then the tunnel:**
   ```
   node src/server.js
   cloudflared tunnel run zippackers
   ```
   Visit `https://app.zippackers.com`.

### Keep it running after you close the terminal / on reboot

Install cloudflared as a background service so the tunnel comes back on boot:

- **Windows (run the terminal as Administrator):**
  ```
  cloudflared service install
  ```
- **macOS/Linux:**
  ```
  sudo cloudflared service install
  ```

The server itself (`node src/server.js`) also needs to stay running. On Windows,
the simplest is a shortcut to it in your Startup folder; or use a process
manager like [PM2](https://pm2.keymetrics.io/) (`pm2 start src/server.js --name
zip-packers && pm2 save`).

---

## Lock it down

Anyone with the link can reach the login page. Access is already gated by the
warehouse passcode and per-client codes, which is enough for a small operation.
To add a login wall in front of everything, turn on **Cloudflare Access** (free
for a handful of users) for the hostname and require a one-time email code or
your Google login. Set this in the Cloudflare dashboard under Zero Trust →
Access → Applications.

---

## Which should I use?

| | Quick tunnel | Named tunnel |
|---|---|---|
| Setup | none | one-time, ~10 min |
| URL | random, changes each run | stable, your domain |
| Certificate | Cloudflare's | Cloudflare's |
| Good for | a quick look from elsewhere | running the business |

For day-to-day use, set up the named tunnel once and install it as a service.
