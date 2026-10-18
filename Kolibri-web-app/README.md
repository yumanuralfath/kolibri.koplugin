# Kolibri

Kolibri is a private reading dashboard for KOReader. The KOReader plugin sends book metadata, current page, page count, and saved highlights to the SvelteKit API. The dashboard stores books, authentication settings, and generated credentials in an embedded SQLite database at `data/kolibri.sqlite`.

## Run locally

1. Start the app with `bun run dev -- --host 0.0.0.0`.
2. Open the app in a browser and create an admin password (at least 12 characters). This setup screen is only available before the first password is saved.
3. In the admin dashboard, open **KOReader setup** and copy the generated sync token.
4. In KOReader, install the sibling `Kolibri.koplugin` folder. Set the server URL to the computer's LAN address, such as `http://192.168.1.10:5173`, and paste the token from the dashboard.
5. Open a book in KOReader or select **Sync current book now**. Keep the computer and reader on the same network.

Use HTTPS when the server is reachable outside a trusted local network. Never expose the development server directly to the public internet. The session cookie is HttpOnly and SameSite; admin APIs require a valid session, while `/api/sync` requires the separate bearer token.

## Dashboard and sharing

The home page is password protected. It shows the reading/finished/paused shelves, page progress, and highlights. Book visibility can be toggled independently. Turning on **Publish** creates an unlisted `/p/<id>` shelf link; only visible books appear there, and highlights remain private. Turning Publish off invalidates the public page.

Each book's **Change cover** controls can search Open Library automatically or accept a direct image URL. Cover results and metadata require an internet connection.

## API

- `POST /api/sync` accepts `{ "book": { "id", "title", "authors", "currentPage", "totalPages" }, "highlights": [{ "text", "page", "note" }] }` with `Authorization: Bearer <KOLIBRI_SYNC_TOKEN>`.
- `GET /api/manage` and `PATCH /api/manage` require the admin session cookie.
- The first `POST /api/auth` with `{ "setup": true, "password": "..." }` creates the admin account; later posts log in with the password.
- `PATCH /api/manage` with `{ "rotateSyncToken": true }` rotates the plugin token. The current token is returned only to an authenticated admin.
- `GET /api/public/<id>` returns the visible public books only while Publish is enabled.

The SQLite database is intended for a single app instance with a persistent writable disk. Back up `data/kolibri.sqlite` regularly. The database directory and file are restricted to the current user on Linux/macOS. The session signing secret and sync token are generated locally and stored in the database. Use **Generate new token** in the admin panel to revoke the old plugin token. If a previous installation has `data/library.json`, Kolibri imports it on the first database start. Runtime needs Node.js with `node:sqlite` support (Node.js 22.13 or newer); Bun can still be used for package management and development commands.
