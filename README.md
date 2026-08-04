# EasyTransfert

**🇫🇷 [Version française](README.fr.md)**

Send files between a Windows PC and a phone over your home Wi-Fi, by scanning a QR code.
Nothing to install on the phone — it only needs a browser.

---

## ⚠️ Read this before using it

**EasyTransfert has no encryption. It is built for a private home network and nothing else.**

Concretely, and without sugar-coating it:

- **Traffic is plain HTTP.** There is no HTTPS, no TLS, no certificate. Every file you
  send crosses the network unencrypted.
- **The access token is in the URL** — inside the QR code, and in the download links.
  Anyone able to observe network traffic can read it.
- **Whoever holds that token owns the shared folder.** They can list, download, upload
  and *delete every file in it*, from any device on the network.
- **There are no accounts, no permissions, no audit trail.** The token, regenerated on
  each start, is the one and only barrier.

**Do not run this on a Wi-Fi network you do not control** — student housing, office,
café, hotel, coworking space, or any shared connection. On such a network, treat every
file you put in the shared folder as public.

The Windows firewall rule it creates is deliberately restricted to the **private** network
profile, so that a network marked "public" in Windows keeps blocking incoming connections.
That is a safety net, not a security guarantee.

If you need to send files over an untrusted network, use a tool that does end-to-end
encryption — [LocalSend](https://localsend.org) is a good one.

---

## What it does

- One web page, shared by the PC and the phone, in French.
- Files land in a `partage/` folder next to the program.
- Uploads show up **live on the other device**, with no refresh (server-sent events).
- Drag and drop from the PC, file picker from the phone, upload progress bar.
- Delete one file, or all of them at once.
- Accented file names survive the round trip.
- **No outbound requests.** No CDN, no remote font, no third-party service, no telemetry.
  Nothing leaves your local network.

## Use it without installing anything

Grab the `.zip` from the [Releases](../../releases) page and unzip it. It ships with its
own copy of Node.js, so nothing else needs to be installed.

> Before unzipping: right-click the `.zip` → Properties → tick **Unblock**. This spares
> you a SmartScreen warning on every extracted file.

Then double-click **`Lancer EasyTransfert`**. Windows will ask once for permission to add
a firewall rule — accept it, otherwise the phone cannot connect. Your browser opens on a
page showing a QR code; point your phone's camera at it.

A step-by-step guide (in French, printable) is included as `Mode d'emploi.html`.

## Run it from source

Requires **Node.js 22 or newer** (it relies on the built-in `fetch`, `File` and
`node:test`).

```bash
npm install
npm start
```

Then, once and as administrator, right-click `setup-firewall.bat` → *Run as
administrator*.

To rebuild the standalone archive:

```powershell
powershell -ExecutionPolicy Bypass -File distribution\creer-archive.ps1
```

## How it works

A single Express process listens on `0.0.0.0:4455` and serves the same responsive page to
both devices. Uploads are streamed straight to disk by `multer` under a temporary `.part`
name, then renamed — an interrupted transfer never leaves a truncated file under its final
name. File identifiers are base64url-encoded names, and every one of them is resolved
through a single guarded function that refuses any path escaping the shared folder.

| File | Responsibility |
|---|---|
| `server.js` | startup: folder, token, network, firewall check, browser launch |
| `src/app.js` | assembles the Express app (without listening) |
| `src/storage.js` | shared folder: sanitising, ids, listing, containment, deletion |
| `src/network.js` | detection of candidate LAN IPv4 addresses |
| `src/security.js` | token generation and auth middleware |
| `src/events.js` | server-sent events broadcasting |
| `src/routes.js` | API router |
| `public/` | the web interface |

Three runtime dependencies (`express`, `multer`, `qrcode`), zero dev dependencies.

```bash
npm test
```

42 tests, using the Node test runner.

## Project status

**Personal project, published as-is.** I wrote it for my own household because the
existing tools were either buggy or slow for my use.

There is **no support**, no roadmap, and no commitment to fix anything. Issues are
disabled on purpose. Feel free to fork it and make it yours — that is what the licence is
for.

Interface, comments and commit messages are in French, and will stay that way.

## Licence

[MIT](LICENSE).

The released archive bundles the official `node.exe` binary, distributed under the
[MIT licence of the Node.js project](https://github.com/nodejs/node/blob/main/LICENSE),
whose text is included in the archive under `node/LICENSE.txt`.
