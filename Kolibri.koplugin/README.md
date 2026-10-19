# Kolibri KOReader plugin

Syncs your KOReader reading statistics, progress and highlights to a Kolibri web app — automatically whenever a network connection is available.

## Install

Copy the whole `Kolibri.koplugin` folder into `koreader/plugins/` and restart KOReader. Open **Tools → Kolibri** and set the server (**Server → URL / Password**), then press **Test connection**.

- **URL**: base address of the app, e.g. `http://192.168.1.10:5173` (the `http://` prefix is added if you leave it out)
- **Password**: the Kolibri admin password

Use HTTPS on untrusted networks; the password is stored in `settings/kolibri.lua` and sent as a bearer token.

## Menu

| Item | What it does |
| --- | --- |
| **Status** | One-line summary; tap for the detailed status screen (connection, auto-sync, last sync, queue, last error) |
| **Sync now** | Immediate sync (works from the file manager too). Offers to connect Wi-Fi if it is off |
| **Auto sync when network is connected** | Master switch for all automatic syncing |
| **Auto sync options** | Choose triggers: network connects · book opens · while reading · book closes. Minimum interval 5–60 min. Optional message after auto sync |
| **Server** | URL, password, test connection |
| **Advanced** | Full resync, clear error, sessions per request |

A gesture action **Kolibri: sync now** is also registered (Settings → Taps and gestures).

## How auto sync behaves

- It never turns Wi-Fi on or shows a connect prompt by itself. If a trigger fires while offline, the work is marked pending and is uploaded when the network connects (or on the next 60 s check while a book is open).
- Page turns only set a flag, so reading stays fast. The actual upload happens at most once per minimum interval.
- Uploads are incremental (only new reading sessions, with a 24 h overlap that the server de-duplicates) and chunked, so large histories no longer hit the server's body-size limit or time out.
- Failed syncs back off for 2 minutes (10 minutes for wrong password / missing config) and the reason is shown in the status screen.

## Files

`main.lua` events and timers · `kolibri_sync.lua` triggers, throttling, chunked upload · `kolibri_stats.lua` statistics DB and book/highlight reading · `kolibri_client.lua` HTTP and error messages · `kolibri_config.lua` settings · `kolibri_ui.lua` menu and status screen.
