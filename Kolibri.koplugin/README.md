# Kolibri KOReader plugin

This plugin sends the current book's metadata, page progress, and saved annotations to a Kolibri web app. Sync is attempted when a book opens and at most once every five minutes while reading. Use **Tools > Kolibri reading stats > Sync current book now** for an immediate upload.

## Install

Copy `Kolibri.koplugin` into the KOReader `koreader/plugins/` directory, then restart KOReader. On the device, open **Tools > Kolibri reading stats** and set:

- **Kolibri server URL**: the base URL of the running app, for example `http://192.168.1.10:5173`
- **Sync token**: copy it from **KOReader setup** in the Kolibri admin dashboard

Use HTTPS when syncing across an untrusted network. Do not share the sync token; it can write to your library.

## Data sent

The plugin posts JSON to `/api/sync` with a bearer token. It includes the document title, authors, language, current page, page count, and the annotations KOReader exposes for the open document. The app merges highlights by page and text, preserving library visibility and cover choices between syncs.
