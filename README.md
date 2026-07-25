# Peta Kesehatan Kabupaten Indragiri Hulu

Sistem Informasi Peta Sebaran Data Kesehatan — Dinas Kesehatan Kabupaten Indragiri Hulu, Provinsi Riau.

Website statis multi-file yang terhubung langsung ke Supabase. Tidak memerlukan server Node.js — bisa di-hosting di GitHub Pages, Netlify, Vercel, atau bahkan dibuka langsung di browser.

---

## Struktur File

```
peta-kesehatan-inhu/
├── index.html              # Halaman peta publik (frontend)
├── login.html              # Halaman login admin
├── dashboard.html          # Halaman dashboard admin
├── css/
│   ├── base.css           # Style global (reset, variables, components)
│   ├── map.css            # Style khusus halaman peta
│   ├── login.css          # Style khusus halaman login
│   └── dashboard.css      # Style khusus dashboard
├── js/
│   ├── config.js          # Konfigurasi Supabase & lainnya
│   ├── supabase.js        # Inisialisasi Supabase client + API helpers
│   ├── auth.js            # Manajemen sesi (login, logout, session)
│   ├── public.js          # Logika halaman peta publik
│   ├── login.js           # Logika halaman login
│   ├── dashboard.js       # Shell dashboard + tab navigation
│   ├── tabs.js            # Implementasi semua tab dashboard
│   ├── chat.js            # AI Chat widget (dipakai di peta & dashboard)
│   └── excel.js           # Excel import/export (client-side)
├── sql/
│   └── schema.sql         # Schema database Supabase (WAJIB dijalankan)
├── supabase-functions/
│   └── chat/
│       └── index.ts       # Edge Function untuk AI chat Groq (opsional, untuk keamanan)
└── README.md              # File ini
```

---

## Setup — 5 Langkah

### Langkah 1: Setup Database Supabase

1. Buka project Supabase Anda: https://supabase.com/dashboard/project/aqxllawmskworpovcofq
2. Buka menu **SQL Editor** → **New query**
3. Buka file `sql/schema.sql` dari folder ini, copy seluruh isinya
4. Paste ke SQL Editor → klik **Run** (Ctrl+Enter)
5. Tunggu sampai muncul "Success. No rows returned"

Database sekarang berisi:
- 7 tabel: users, categories, subcategories, districts, case_records, user_permissions, settings, chat_history
- 14 kecamatan Indragiri Hulu
- 3 kategori + 3 subkategori awal (TB, Ibu Hamil, Stunting)
- 1 super admin default
- Sample data kasus per kecamatan
- Row Level Security (RLS) policies
- Function `verify_login()` dan `hash_password()`

### Langkah 2: Buka Website

Cukup buka file `index.html` di browser. Tidak perlu web server.

Atau untuk pengalaman terbaik, gunakan web server lokal:
```bash
# Python
python3 -m http.server 8080

# atau Node.js (http-server)
npx http-server -p 8080

# lalu buka http://localhost:8080
```

### Langkah 3: Login Admin

1. Buka `login.html` di browser (atau klik link dari halaman utama jika ada)
2. Login dengan kredensial default:
   - **Email:** `admin@dinkes.go.id`
   - **Password:** `admin123`
3. Setelah login, Anda akan diarahkan ke `dashboard.html`

### Langkah 4: Set Groq API Key

1. Dapatkan API key Groq gratis di https://console.groq.com/keys
2. Login ke dashboard → tab **Pengaturan**
3. Isi **Groq API Key** → klik **Simpan Pengaturan AI**
4. Sekarang fitur AI Chat sudah aktif (mode client-side)

### Langkah 5: (Opsional) Deploy Edge Function untuk Keamanan

Mode client-side (Langkah 4) mengekspos API key Groq ke browser. Untuk keamanan penuh, deploy Edge Function:

1. Install Supabase CLI: https://supabase.com/docs/guides/cli
2. Login: `supabase login`
3. Link project:
   ```bash
   supabase link --project-ref aqxllawmskworpovcofq
   ```
4. Deploy function:
   ```bash
   supabase functions deploy chat --no-verify-jwt
   ```
5. Setelah deploy, salin URL function:
   ```
   https://aqxllawmskworpovcofq.supabase.co/functions/v1/chat
   ```
6. Edit file `js/config.js`, isi `GROQ_EDGE_FUNCTION_URL` dengan URL tersebut:
   ```javascript
   GROQ_EDGE_FUNCTION_URL: 'https://aqxllawmskworpovcofq.supabase.co/functions/v1/chat',
   ```
7. Refresh website. Sekarang API key Groq aman di server.

---

## Fitur

### Halaman Publik (`index.html`)
- Peta Leaflet dengan 14 marker kecamatan
- Warna marker berdasarkan tingkat risiko (Stunting): rendah/sedang/tinggi
- Popup detail per kecamatan (klik marker)
- Tanggal update terakhir per kasus (format "dd mm yy" kecil)
- Tombol "Tanya AI" — chat widget AI Groq (publik, tidak perlu login)
- Header formal pemerintahan dengan lambang Kab. Indragiri Hulu
- Favicon dari lambang Inhu

### Halaman Login (`login.html`)
- Login terpisah (tidak di halaman depan)
- Menggunakan SQL function `verify_login` (password di-hash dengan bcrypt via pgcrypto)
- Sesi disimpan di localStorage (7 hari)

### Dashboard Admin (`dashboard.html`)
Setelah login, dashboard memiliki 7 tab:

1. **📋 Data Kasus** — CRUD data kasus per kecamatan/kategori/subkategori
   - Filter by kecamatan & kategori
   - Permission check: user biasa hanya lihat/edit subkategori yang diizinkan
2. **🗂️ Kategori & Subkategori** (Super Admin only)
   - Tambah/edit/hapus kategori & subkategori
   - Toggle aktif/nonaktif (subkategori nonaktif tidak tampil di frontend)
3. **🗺️ Kecamatan** — CRUD kecamatan + koordinat
4. **👥 Manajemen User** (Super Admin only)
   - Buat akun operator
   - **Centang subkategori yang boleh diakses** per user
   - Role: super_admin (akses penuh) atau user (operator terbatas)
5. **📊 Import / Export Excel**
   - Export ke .xlsx dengan heading kustom (3 baris)
   - Import dari .xlsx untuk bulk update
6. **🤖 AI Chat** — Chat internal admin dengan database
7. **⚙️ Pengaturan** (Super Admin only)
   - Groq API key & model
   - 3 baris heading Excel (dengan preview)
   - Nama situs

---

## Default Credentials

| Field  | Value                  |
|--------|------------------------|
| URL    | `login.html`           |
| Email  | `admin@dinkes.go.id`   |
| Password | `admin123`           |

⚠️ **WAJIB ganti password setelah login pertama!**
Untuk mengubah password super admin, jalankan SQL berikut di Supabase SQL Editor:
```sql
update users
set password_hash = crypt('PASSWORD_BARU_ANDA', gen_salt('bf', 10))
where email = 'admin@dinkes.go.id';
```

---

## Konfigurasi

Semua konfigurasi ada di `js/config.js`:

```javascript
window.CONFIG = {
  SUPABASE_URL: 'https://aqxllawmskworpovcofq.supabase.co',
  SUPABASE_ANON_KEY: '...',
  GROQ_EDGE_FUNCTION_URL: '',  // isi setelah deploy Edge Function
  GROQ_DEFAULT_MODEL: 'llama-3.3-70b-versatile',
  LOGO_URL: 'https://upload.wikimedia.org/wikipedia/commons/9/94/Lambang_Kab_Indragiri_Hulu.png',
  // ...
}
```

---

## Catatan Keamanan

### Mode Default (tanpa Edge Function)
- **Password**: di-hash dengan bcrypt via pgcrypto di server (aman)
- **Session**: custom JWT disimpan di localStorage (kurang ideal, tapi OK untuk internal use)
- **Groq API Key**: disimpan di tabel settings, **terlihat di network request** saat chat
- **RLS**: semua tabel punya Row Level Security policy

### Mode Produksi (dengan Edge Function)
- Groq API key **tidak pernah** diekspos ke client
- Semua request chat melalui Edge Function (server-side)
- Disarankan untuk deployment pemerintahan

### Untuk Keamanan Maksimal
Pertimbangkan untuk:
1. Menggunakan Supabase Auth bawaan (bukan custom JWT)
2. Memindahkan semua operasi tulang ke Edge Functions
3. Mengaktifkan CAPTCHA di halaman login
4. Membatasi CORS ke domain spesifik saja

---

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6+), Leaflet.js
- **Database**: Supabase (PostgreSQL) dengan RLS
- **AI**: Groq API (llama-3.3-70b-versatile)
- **Excel**: SheetJS (xlsx) — client-side
- **Auth**: pgcrypto (bcrypt) + custom JWT (HMAC SHA-256)
- **External Libraries**:
  - Supabase JS v2 (CDN)
  - Leaflet 1.9.4 (CDN)
  - SheetJS 0.18.5 (CDN)
  - Google Fonts: Poppins + Inter

---

## Troubleshooting

### "Gagal memuat data peta"
- Pastikan Anda sudah menjalankan `sql/schema.sql` di Supabase SQL Editor
- Cek koneksi internet (Supabase butuh internet)
- Buka Developer Tools (F12) → Console untuk lihat error detail

### "Email atau password salah"
- Gunakan kredensial default: `admin@dinkes.go.id` / `admin123`
- Pastikan tidak ada spasi sebelum/sesudah email
- Jika lupa password super admin, reset via SQL:
  ```sql
  update users
  set password_hash = crypt('admin123', gen_salt('bf', 10))
  where email = 'admin@dinkes.go.id';
  ```

### "API Key Groq belum dikonfigurasi"
- Login sebagai super admin → tab Pengaturan → isi Groq API Key
- Dapatkan API key gratis di https://console.groq.com/keys

### Tab "Kategori" / "User" / "Pengaturan" tidak muncul
- Tab-tab tersebut hanya untuk Super Admin
- Login sebagai super_admin (bukan operator)

### Excel import gagal
- Pastikan kolom header: "Kecamatan", "Subkategori", "Nilai" (case-insensitive)
- Nama kecamatan & subkategori harus sama persis dengan di database
- Coba Export dulu untuk lihat format yang benar

---

## Lisensi & Credits

- **Logo**: [Lambang Kabupaten Indragiri Hulu](https://upload.wikimedia.org/wikipedia/commons/9/94/Lambang_Kab_Indragiri_Hulu.png) — Wikipedia Commons
- **Peta**: © OpenStreetMap contributors
- **AI**: Groq
- **Database**: Supabase

© Dinas Kesehatan · Pemerintah Kabupaten Indragiri Hulu
