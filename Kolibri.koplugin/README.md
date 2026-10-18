# Kolibri KOReader plugin

This plugin sends the current book's metadata, page progress, and saved annotations to a Kolibri web app. Sync is queued when a book opens, when network connectivity returns, and at most once every five minutes while reading. Use **Tools > Kolibri reading stats > Sync current book now** for an immediate upload.

## Install

Copy `Kolibri.koplugin` into the KOReader `koreader/plugins/` directory, then restart KOReader. On the device, open **Tools > Kolibri reading stats** and set:

- **Kolibri server URL**: the base URL of the running app, for example `http://192.168.1.10:5173`
- **Kolibri password**: the same password used to sign in to the Kolibri admin dashboard

Use HTTPS when syncing across an untrusted network. The plugin stores your admin password in KOReader settings and sends it to the configured Kolibri server for authentication. Only configure a server URL you trust.

## Data sent

The plugin posts JSON to `/api/sync` with the admin password as a bearer credential. It includes the document title, authors, language, current page, page count, and the annotations KOReader exposes for the open document. The app merges highlights by page and text, preserving library visibility and cover choices between syncs.
