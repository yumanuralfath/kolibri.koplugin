# Kolibri KOReader plugin

This plugin sends the KOReader statistics database's book list and page-reading history, plus the current book's progress and saved annotations, to a Kolibri web app. Sync is queued when a book opens, when network connectivity returns, and at most once every five minutes while reading. Use **Tools > Kolibri reading stats > Sync current book now** for an immediate upload. Sync imports the full statistics history, not only the currently opened book.

## Install

Copy `Kolibri.koplugin` into the KOReader `koreader/plugins/` directory, then restart KOReader. On the device, open **Tools > Kolibri reading stats** and set:

- **Kolibri server URL**: the base URL of the running app, for example `http://192.168.1.10:5173`
- **Kolibri password**: the same password used to sign in to the Kolibri admin dashboard

Use HTTPS when syncing across an untrusted network. The plugin stores your admin password in KOReader settings and sends it to the configured Kolibri server for authentication. Only configure a server URL you trust.

## Data sent

The plugin posts JSON to `/api/sync` with the admin password as a bearer credential. It reads books and page sessions from `statistics.sqlite3`, and sends current-document annotations. The app merges sessions by book, page, and timestamp, and merges highlights by page and text, preserving library visibility and cover choices between syncs.
