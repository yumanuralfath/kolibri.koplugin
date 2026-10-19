# Kolibri

Dashboard bacaan pribadi untuk [KOReader](https://koreader.rocks). Plugin KOReader mengirim buku, halaman terakhir, riwayat membaca, dan highlight ke web app SvelteKit. Web app menyimpan semuanya di [Turso](https://turso.tech) (libSQL), menampilkan statistik, dan bisa membagikan rak buku publik.

## Isi repo

| Folder | Fungsi |
| --- | --- |
| `Kolibri-web-app/` | Dashboard SvelteKit (Svelte 5, Tailwind 4, Chart.js) dan API |
| `Kolibri.koplugin/` | Plugin KOReader untuk sinkronisasi otomatis |
| `.github/workflows/release.yml` | Workflow rilis zip plugin KOReader |

## Fitur

- Tanggal **mulai dibaca** dan **terakhir dibaca** diambil dari sesi baca pertama dan terakhir (seperti statistik KOReader).
- Rak **sedang dibaca / selesai / dijeda** dengan progres halaman.
- Statistik dari riwayat KOReader: halaman per hari, waktu baca per bulan, pola hari, hari aktif, hari terpanjang.
- Highlight dan catatan, yang bisa disembunyikan atau diedit per item.
- **Detail per buku**: status baca, tanggal tamat, visibilitas di rak publik, hapus buku, dan **ganti sampul**.
- **Sampul buku**: tempel URL gambar, upload file (JPG/PNG/WebP/GIF, maks 4 MB), cari otomatis lewat Open Library, atau hapus sampul.
- **Rak publik** di `/public`: hanya buku yang ditandai tampil, dan highlight yang disembunyikan tidak pernah dikirim.
- Tema terang/gelap.

## Konfigurasi database (Turso)

Database embedded sudah dihapus. Semua data (buku, sesi baca, pengaturan, dan sampul upload) disimpan di Turso lewat environment variable:

| Variable | Keterangan |
| --- | --- |
| `TURSO_DATABASE_URL` | URL database, contoh `libsql://nama-db-org.turso.io` |
| `TURSO_AUTH_TOKEN` | Token Turso |

Buat database dan token:

```bash
turso db create kolibri
turso db show kolibri --url
turso db tokens create kolibri
```

Tabel dibuat otomatis saat request pertama. Untuk dev lokal tanpa Turso, bisa pakai `TURSO_DATABASE_URL=file:local.db`. Salin `Kolibri-web-app/.env.example` menjadi `.env`.

## Menjalankan web app

```bash
cd Kolibri-web-app
bun install
cp .env.example .env            # isi TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN
bun run dev -- --host 0.0.0.0   # http://localhost:5173
```

Buka di browser dan buat password admin (minimal 12 karakter). Layar setup hanya muncul sebelum password pertama disimpan.

Perintah lain: `bun run build`, `bun run check` (svelte-check), `bun run lint`, `bun run format`.

## Deploy ke Vercel

1. Push repo ke GitHub, lalu import di Vercel.
2. Atur **Root Directory** ke `Kolibri-web-app`.
3. Tambahkan environment variable `TURSO_DATABASE_URL` dan `TURSO_AUTH_TOKEN`.
4. Deploy. Proyek memakai `@sveltejs/adapter-vercel`.
5. Buka URL Vercel, buat password admin, lalu isi URL itu (`https://...vercel.app`) di plugin KOReader.

Vercel membatasi body request sekitar 4.5 MB. Plugin mengirim data bertahap, dan gambar sampul diperkecil di browser sebelum diupload.

## Memasang plugin KOReader

1. Salin folder `Kolibri.koplugin` ke `koreader/plugins/`, lalu restart KOReader.
2. Buka **Tools → Kolibri → Server**, isi **URL** (contoh `http://192.168.1.10:5173`) dan **Password** admin yang sama.
3. Tekan **Test connection**.
4. Buka sebuah buku. Sinkronisasi berjalan otomatis saat jaringan tersedia. **Sync now** tersedia untuk sinkron manual.

Detail menu dan perilaku auto sync ada di [`Kolibri.koplugin/README.md`](Kolibri.koplugin/README.md).

## Data dan backup

Semua data ada di Turso: tabel `books`, `reading_sessions`, `settings`, `deleted_books`, dan `covers` (sampul upload). Tidak ada file lokal yang perlu dipersistenkan, jadi cocok untuk Vercel. Backup lewat fitur Turso, misalnya `turso db shell kolibri .dump > backup.sql`.

## Berbagi rak publik

Di dashboard, aktifkan **Publish**. Halaman `/public` menampilkan buku yang visible saja. Jika Publish dimatikan, akses publik ditutup. Sampul upload disimpan di database dan disajikan lewat `/api/covers/file/<nama>` tanpa login, supaya bisa tampil di rak publik.

## API

| Endpoint | Auth | Fungsi |
| --- | --- | --- |
| `POST /api/auth` | - | Setup admin (`{"setup": true, "password": "..."}`) atau login |
| `PATCH /api/auth` | sesi | Ganti password |
| `POST /api/sync` | `Authorization: Bearer <password>` | Terima buku, statistik, dan highlight dari plugin |
| `GET /api/manage` | sesi | Ambil seluruh library |
| `PATCH /api/manage` | sesi | Ubah visibilitas, status, tanggal, `coverUrl`, highlight, publish |
| `DELETE /api/manage` | sesi | Hapus buku (beserta file sampul uploadnya) |
| `GET /api/covers?q=` | - | Cari sampul di Open Library |
| `POST /api/covers` | sesi | Cari sampul otomatis untuk buku yang belum punya |
| `POST /api/covers/upload?bookId=` | sesi | Upload gambar sampul (body = bytes gambar) |
| `GET /api/covers/file/<nama>` | - | Sajikan sampul yang diupload |
| `GET /api/public/<id>` | - | Daftar buku publik saat Publish aktif |

## Keamanan

- Plugin mengirim password admin sebagai bearer token. Pakai HTTPS di luar jaringan tepercaya dan jangan buka dev server langsung ke internet.
- API admin memakai cookie sesi HttpOnly dan SameSite.
- File upload dicek lewat magic bytes, dibatasi 4 MB, dan disimpan di Turso dengan nama acak.

## Lisensi

Belum ditentukan. Tambahkan file `LICENSE` sesuai kebutuhan.
