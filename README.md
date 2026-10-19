# Kolibri

Dashboard bacaan pribadi untuk [KOReader](https://koreader.rocks). Plugin KOReader mengirim buku, halaman terakhir, riwayat membaca, dan highlight ke web app SvelteKit. Web app menyimpan semuanya di SQLite, menampilkan statistik, dan bisa membagikan rak buku publik.

## Isi repo

| Folder                          | Fungsi                                                       |
| ------------------------------- | ------------------------------------------------------------ |
| `Kolibri-web-app/`              | Dashboard SvelteKit (Svelte 5, Tailwind 4, Chart.js) dan API |
| `Kolibri.koplugin/`             | Plugin KOReader untuk sinkronisasi otomatis                  |
| `.github/workflows/release.yml` | Workflow rilis zip plugin KOReader                           |

## Fitur

- Rak **sedang dibaca / selesai / dijeda** dengan progres halaman.
- Statistik dari riwayat KOReader: halaman per hari, waktu baca per bulan, pola hari, hari aktif, hari terpanjang.
- Highlight dan catatan, yang bisa disembunyikan atau diedit per item.
- **Detail per buku**: status baca, tanggal tamat, visibilitas di rak publik, hapus buku, dan **ganti sampul**.
- **Sampul buku**: tempel URL gambar, upload file (JPG/PNG/WebP/GIF, maks 5 MB), cari otomatis lewat Open Library, atau hapus sampul.
- **Rak publik** di `/public`: hanya buku yang ditandai tampil, dan highlight yang disembunyikan tidak pernah dikirim.
- Tema terang/gelap.

## Menjalankan web app

Butuh Node.js 22.13+ (memakai `node:sqlite`). Bun dipakai untuk paket dan perintah dev.

```bash
cd Kolibri-web-app
bun install
bun run dev -- --host 0.0.0.0   # http://localhost:5173
```

Buka di browser dan buat password admin (minimal 12 karakter). Layar setup hanya muncul sebelum password pertama disimpan.

Produksi:

```bash
bun run build
node build        # memakai adapter-node
```

Perintah lain: `bun run check` (svelte-check), `bun run lint`, `bun run format`.

## Memasang plugin KOReader

1. Salin folder `Kolibri.koplugin` ke `koreader/plugins/`, lalu restart KOReader.
2. Buka **Tools → Kolibri → Server**, isi **URL** (contoh `http://192.168.1.10:5173`) dan **Password** admin yang sama.
3. Tekan **Test connection**.
4. Buka sebuah buku. Sinkronisasi berjalan otomatis saat jaringan tersedia. **Sync now** tersedia untuk sinkron manual.

Detail menu dan perilaku auto sync ada di [`Kolibri.koplugin/README.md`](Kolibri.koplugin/README.md).

## Data dan backup

Semua data ada di folder `data/` pada direktori kerja web app:

- `data/kolibri.sqlite`: buku, sesi baca, pengaturan, dan kredensial admin.
- `data/covers/`: sampul yang diupload lewat dashboard.

Folder ini harus berada di disk yang persisten dan perlu dibackup rutin (keduanya, supaya sampul upload tidak hilang). Aplikasi dirancang untuk satu instance. Jika ada `data/library.json` dari versi lama, isinya diimpor saat database pertama kali dibuat.

## Berbagi rak publik

Di dashboard, aktifkan **Publish**. Halaman `/public` menampilkan buku yang visible saja. Jika Publish dimatikan, akses publik ditutup. Sampul upload diakses lewat `/api/covers/file/<nama>` tanpa login, supaya bisa tampil di rak publik.

## API

| Endpoint                          | Auth                               | Fungsi                                                            |
| --------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| `POST /api/auth`                  | -                                  | Setup admin (`{"setup": true, "password": "..."}`) atau login     |
| `PATCH /api/auth`                 | sesi                               | Ganti password                                                    |
| `POST /api/sync`                  | `Authorization: Bearer <password>` | Terima buku, statistik, dan highlight dari plugin                 |
| `GET /api/manage`                 | sesi                               | Ambil seluruh library                                             |
| `PATCH /api/manage`               | sesi                               | Ubah visibilitas, status, tanggal, `coverUrl`, highlight, publish |
| `DELETE /api/manage`              | sesi                               | Hapus buku (beserta file sampul uploadnya)                        |
| `GET /api/covers?q=`              | -                                  | Cari sampul di Open Library                                       |
| `POST /api/covers`                | sesi                               | Cari sampul otomatis untuk buku yang belum punya                  |
| `POST /api/covers/upload?bookId=` | sesi                               | Upload gambar sampul (body = bytes gambar)                        |
| `GET /api/covers/file/<nama>`     | -                                  | Sajikan sampul yang diupload                                      |
| `GET /api/public/<id>`            | -                                  | Daftar buku publik saat Publish aktif                             |

## Keamanan

- Plugin mengirim password admin sebagai bearer token. Pakai HTTPS di luar jaringan tepercaya dan jangan buka dev server langsung ke internet.
- API admin memakai cookie sesi HttpOnly dan SameSite.
- File upload dicek lewat magic bytes, dibatasi 5 MB, dan disimpan dengan nama acak.

## Lisensi

Belum ditentukan. Tambahkan file `LICENSE` sesuai kebutuhan.
