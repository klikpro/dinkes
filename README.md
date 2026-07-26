# Peta Kesehatan Kabupaten Indragiri Hulu — SECURITY-HARDENED VERSION

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
│   ├── config.js          # Konfigurasi Supabase (NO hardcoded credentials)
│   ├── supabase.js        # Inisialisasi Supabase client + API helpers (safe error handling)
│   ├── auth.js            # Manajemen sesi (login via Edge Function, rate limiting, fingerprinting)
│   ├── public.js          # Logika halaman peta publik (XSS-safe)
│   ├── login.js           # Logika halaman login (rate limiting UI, validation)
│   ├── dashboard.js       # Shell dashboard + tab navigation + forced/voluntary password change
│   ├── tabs.js            # Implementasi semua tab dashboard (XSS-safe, input validation)
│   ├── chat.js            # AI Chat widget (XSS-safe)
│   └── excel.js           # Excel import/export (client-side, formula-injection safe)
├── sql/
│   ├── schema.sql         # Schema database original
│   ├── schema_fixed.sql   # Schema database fixed (UNIQUE constraint)
│   └── schema_secure.sql  # Schema database SECURITY-HARDENED (WAJIB untuk produksi)
├── supabase-functions/
│   ├── auth-login/
│   │   └── index.ts       # Edge Function login (WAJIB) — verifikasi password + JWT bertanda tangan asli
│   └── chat/
│       └── index.ts       # Edge Function AI chat Groq (CORS restricted, rate limited)
└── README.md              # File ini
```

---

## Setup — 8 Langkah

### Langkah 1: Setup Database Supabase (WAJIB gunakan schema_secure.sql)

**Untuk deployment produksi, gunakan `sql/schema_secure.sql` — bukan schema.sql atau schema_fixed.sql.**

1. Buka project Supabase Anda
2. Buka menu **SQL Editor** → **New query**
3. Buka file `sql/schema_secure.sql` dari folder ini, copy seluruh isinya
4. Paste ke SQL Editor → klik **Run** (Ctrl+Enter)
5. Tunggu sampai muncul "Success. No rows returned"

Database sekarang berisi:
- 10 tabel: users, categories, subcategories, districts, case_records, user_permissions, settings, chat_history, login_attempts, audit_log
- 1 view: public_settings (masks groq_api_key)
- 14 kecamatan Indragiri Hulu
- 3 kategori + 3 subkategori awal (TB, Ibu Hamil, Stunting)
- 1 super admin default (password_changed_at = NULL = harus ganti — dashboard akan MEMAKSA ganti password di login pertama, lihat Langkah 5)
- Sample data kasus per kecamatan
- Row Level Security (RLS) policies — HARDENED, dan hanya benar-benar berlaku jika Langkah 2 di bawah dilakukan
- Function `verify_login()` dengan rate limit check, `hash_password()`, `check_login_rate_limit()`, `clear_login_attempts()`, `change_own_password()`
- Audit logging triggers untuk users, case_records, settings, user_permissions
- Value constraint: case_records.value >= 0 and <= 999999; notes <= 500 karakter

### Langkah 2: Deploy Edge Function "auth-login" (WAJIB — bukan opsional)

**Versi ini TIDAK BISA login tanpa langkah ini.** Login memverifikasi password di server dan membuat JWT yang ditandatangani dengan JWT secret ASLI project Anda — bukan dibuat/ditandatangani di browser seperti versi sebelumnya (yang bisa dipalsukan siapa saja karena memakai anon key yang publik sebagai kunci tanda tangan, dan yang pada praktiknya membuat SEMUA operasi tulis di dashboard gagal karena RLS hanya mengizinkan role `authenticated`).

1. Install Supabase CLI: https://supabase.com/docs/guides/cli
2. Login: `supabase login`
3. Link project: `supabase link --project-ref YOUR_PROJECT_REF`
4. **PENTING**: Edit `supabase-functions/auth-login/index.ts` → ganti `ALLOWED_ORIGINS` dengan domain deployment Anda
5. Deploy: `supabase functions deploy auth-login --no-verify-jwt`
6. Set secret JWT: `supabase secrets set SUPABASE_JWT_SECRET=<JWT secret project Anda>`
   - Ambil dari Dashboard → Project Settings → Data API → JWT Settings → "Legacy JWT secret"
   - Jika project Anda hanya punya signing key asimetris (ECC/RSA) tanpa "legacy JWT secret", pendekatan ini tidak akan bekerja — Anda perlu migrasi ke Supabase Auth asli (`supabase.auth.signInWithPassword`) alih-alih tabel `users` kustom.
7. Edit `js/config.js`, isi `AUTH_LOGIN_EDGE_FUNCTION_URL` dengan URL function (format: `https://<project-ref>.supabase.co/functions/v1/auth-login`)

### Langkah 3: Buka Website

Cukup buka file `index.html` di browser. Tidak perlu web server.

Atau untuk pengalaman terbaik, gunakan web server lokal:
```bash
# Python
python3 -m http.server 8080

# atau Node.js (http-server)
npx http-server -p 8080

# lalu buka http://localhost:8080
```

### Langkah 4: Login Admin

1. Buka `login.html` di browser
2. Login dengan kredensial yang diberikan oleh administrator
   - **Catatan**: Kredensial default TIDAK ditampilkan di halaman login untuk keamanan
   - Hubungi Super Admin untuk mendapatkan akun
3. Setelah login, Anda akan diarahkan ke `dashboard.html`

### Langkah 5: GANTI PASSWORD DEFAULT (WAJIB, dipaksa otomatis)

Karena `password_changed_at` masih NULL untuk super admin default, dashboard akan **otomatis memblokir semua tab** dan menampilkan form "Ganti Password" di login pertama — tidak perlu SQL manual lagi. Isi password lama (`admin123`) dan password baru, submit, lalu login ulang. Pengguna lain juga bisa mengganti password kapan saja lewat tombol **🔑 Ganti Password** di header dashboard.

### Langkah 6: Set Groq API Key

1. Dapatkan API key Groq gratis di https://console.groq.com/keys
2. Login ke dashboard → tab **Pengaturan**
3. Isi **Groq API Key** → klik **Simpan Pengaturan AI**
4. Sekarang fitur AI Chat sudah aktif

### Langkah 7: Deploy Edge Function "chat" untuk Keamanan Maksimal

Mode client-side mengekspos API key Groq ke browser. Untuk keamanan penuh, deploy Edge Function:

1. Install Supabase CLI: https://supabase.com/docs/guides/cli
2. Login: `supabase login`
3. Link project:
   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   ```
4. **PENTING**: Edit `supabase-functions/chat/index.ts` → ganti `ALLOWED_ORIGINS` dengan domain deployment Anda
5. Deploy function:
   ```bash
   supabase functions deploy chat --no-verify-jwt
   ```
6. Setelah deploy, edit file `js/config.js`, isi `GROQ_EDGE_FUNCTION_URL`
7. Refresh website. Sekarang API key Groq aman di server.

---

## Security Hardening — Detail

Versi ini telah diperkuat dengan 17+ patch keamanan dibandingkan versi original:

### CRITICAL Level Fixes

| # | Vulnerability | Fix |
|---|---|---|
| 1 | **Exposed credentials on login page** — default email/password ditampilkan di HTML | Dihapus, diganti "Hubungi Super Admin untuk mendapatkan akun" |
| 2 | **Hardcoded admin password in config.js** — `DEFAULT_ADMIN_PASSWORD: 'admin123'` | Dihapus dari config.js; kredensial hanya di SQL seed data |
| 3 | **No Content Security Policy (CSP)** — XSS injection melalui inline scripts dimungkinkan | CSP meta tag ditambahkan di semua 3 HTML pages, membatasi script-src, connect-src, frame-src, object-src |
| 4 | **No security response headers** — clickjacking, MIME sniffing, info leakage | X-Content-Type-Options, X-Frame-Options (DENY), Referrer-Policy, Permissions-Policy, HSTS ditambahkan |
| 5 | **No Subresource Integrity (SRI)** — CDN scripts bisa di-tamper | SRI integrity attributes ditambahkan (placeholder hash, harus di-compute sebelum deploy) |
| 6 | **No login rate limiting** — brute force attack dimungkinkan | Client-side: 5 failed attempts → 15 min lockout + countdown UI. Server-side: `login_attempts` table + `verify_login()` rate check |
| 7 | **Weak session management** — 7-day expiry, no fingerprinting | Expiry reduced to 24 hours. Session fingerprinting (user agent hash). validateSession() re-validates server-side |
| 8 | **No input validation before API calls** — email/password sent without format check | Email regex validation, password min 8 chars, maxlength on all inputs |

### HIGH Level Fixes

| # | Vulnerability | Fix |
|---|---|---|
| 9 | **XSS via innerHTML** — all dynamic data rendered unsanitized | `sanitizeHtml()` function applied to ALL user-controlled data in tabs.js, chat.js, public.js, dashboard.js, supabase.js |
| 10 | **Overly permissive RLS policies** — users, permissions, settings readable by anyone | HARDENED: users only readable by super_admin + own record. user_permissions: super_admin + own. settings: authenticated only. groq_api_key masked via `public_settings` view |
| 11 | **hash_password() accessible by anon** — can be abused for offline hash computation | `revoke execute on function hash_password from anon` — hanya authenticated bisa memanggil |
| 12 | **Wildcard CORS in Edge Function** — `Access-Control-Allow-Origin: *` | Dynamic CORS: hanya ALLOWED_ORIGINS yang di-allow. Edit `ALLOWED_ORIGINS` sebelum deploy |
| 13 | **case_records write unrestricted** — any authenticated user can insert/update/delete | RLS: hanya super_admin atau user dengan `can_input` permission untuk subcategory tersebut |
| 14 | **districts/categories/subcategories writable by any authenticated user** | RLS: hanya super_admin bisa write |

### MEDIUM Level Fixes

| # | Vulnerability | Fix |
|---|---|---|
| 15 | **Internal error messages exposed** — Supabase SQL errors visible to users | `safeErrorMessage()` function — hanya expose known errors, hide internals |
| 16 | ~~No CSRF protection~~ | Ditinjau ulang (lihat Ronde 2 #10) — implementasi awal berupa token yang dibuat tapi tak pernah benar-benar dikirim/diverifikasi, jadi dihapus alih-alih dipertahankan sebagai proteksi palsu |
| 17 | **No value range validation** — case_records.value unchecked | SQL constraint `check (value >= 0 and value <= 999999)`, JS validation min/max |
| 18 | **No maxlength on text inputs** — unlimited data could be injected | maxlength added: email 100, password 128, name 50, notes 500 |

### LOW Level Fixes

| # | Vulnerability | Fix |
|---|---|---|
| 19 | **No password strength indicator** | `checkPasswordStrength()` function: shows Lemah/Cukup/Kuat when creating users |
| 20 | **No audit logging** — who did what, when? | `audit_log` table + triggers on users, case_records, settings, user_permissions |
| 21 | **No forced password change enforcement** | `password_changed_at` column in users (NULL = still default password) |
| 22 | **Edge Function: no input length limit** | Max 500 chars for chat message + HTML tag stripping |
| 23 | **Edge Function: no rate limiting** | In-memory per-IP rate limit: 20 requests/minute |
| 24 | **desktop.ini files in project** | Removed |

---

## Security Hardening — Ronde 2 (Audit Ulang)

Audit ulang menemukan bahwa versi "SECURITY-HARDENED" sebelumnya, meski memperbaiki banyak hal, punya **satu cacat arsitektur kritis** dan beberapa bug yang membuat sebagian perbaikan tidak benar-benar berfungsi:

| # | Level | Masalah | Perbaikan |
|---|---|---|---|
| 1 | **CRITICAL** | Sesi login ditandatangani (HMAC) di browser memakai **anon key** sebagai secret — anon key bersifat publik (ada di `config.js`), jadi siapa pun bisa memalsukan JWT dengan `role: super_admin`. | Login sekarang lewat Edge Function `auth-login` yang memverifikasi password di server dan menandatangani JWT dengan JWT secret asli project (env secret, tidak pernah sampai ke browser). |
| 2 | **CRITICAL** | `setSupabaseAuth()` sengaja dibuat no-op (token custom tidak pernah benar-benar dikirim) karena akan ditolak Supabase. Akibatnya semua request selalu berjalan sebagai `anon`, dan karena `schema_secure.sql` membatasi tulis hanya untuk `authenticated`, **seluruh fitur simpan/edit/hapus di dashboard gagal total**. | `setSupabaseAuth()` sekarang benar-benar memasang header `Authorization: Bearer <JWT valid>`, sehingga RLS `to authenticated` bekerja sesuai desain. |
| 3 | **CRITICAL** | `sql/schema_secure.sql`: typo `timestammtz` pada kolom `users.created_at` — seluruh script SQL gagal dijalankan. | Diperbaiki menjadi `timestamptz`. |
| 4 | **CRITICAL** | RLS policy `case_records` (insert & update) memakai `new.subcategory_id` — `NEW`/`OLD` tidak valid di luar trigger function, sehingga setiap insert/update data kasus akan gagal dengan SQL error. | Diperbaiki menjadi referensi kolom langsung (`subcategory_id` / `case_records.subcategory_id`), sesuai cara RLS Postgres membaca baris baru pada klausa `WITH CHECK`. |
| 5 | **HIGH** | Tabel `login_attempts` punya policy `for all using(true)` tanpa batasan role, plus grant langsung ke `authenticated` — siapa saja yang authenticated bisa membaca daftar email yang gagal login, atau insert baris "sukses" palsu. | Grant langsung dicabut; akses hanya lewat fungsi SECURITY DEFINER (`verify_login`, dll) yang tetap bisa insert karena berjalan sebagai owner; SELECT langsung dibatasi untuk super_admin saja. |
| 6 | **HIGH** | `password_changed_at` hanya **dicatat**, tidak pernah **ditegakkan** — user bisa memakai password default (`admin123`) selamanya tanpa diminta ganti. Selain itu, user non-super-admin tidak punya cara mengganti password sendiri sama sekali (RLS `users` hanya bisa ditulis oleh super_admin). | Dashboard sekarang memblokir semua tab dan memaksa ganti password jika `password_changed_at` masih NULL. Fungsi baru `change_own_password()` (SECURITY DEFINER, memakai `current_user_id()` dari JWT — bukan id kiriman client) memungkinkan siapa pun mengganti password sendiri kapan saja lewat tombol "🔑 Ganti Password". |
| 7 | **MEDIUM** | Export Excel menulis field bebas (`Catatan`/notes, diisi user operator) langsung ke sel tanpa perlindungan — nilai yang diawali `=`, `+`, `-`, `@` bisa dieksekusi sebagai formula/DDE saat file dibuka di Excel oleh super_admin (formula/CSV injection). | Ditambahkan `ExcelIO.sanitizeCell()` yang membubuhi apostrof di depan nilai semacam itu sebelum ditulis ke `.xlsx`. |
| 8 | **MEDIUM** | Batas 500 karakter untuk `notes` hanya di client (`maxlength`), bisa dilewati dengan memanggil API langsung. | Ditambahkan `check` constraint di database: `char_length(notes) <= 500`. |
| 9 | **LOW** | SRI hash untuk `@supabase/supabase-js` memakai tag versi mengambang `@2`, yang isinya bisa berubah kapan saja tanpa hash SRI ikut diperbarui — merusak tujuan SRI itu sendiri (dan file bisa berubah menjadi tidak cocok dengan hash placeholder). | Dipin ke versi eksak `@2.52.1`. Instruksi `curl` di README diperbarui agar cocok persis dengan URL yang dipin. |

**Catatan penting**: karena perbaikan #1 dan #2 di atas, `js/auth.js` tidak lagi membuat JWT sendiri di browser (fungsi `createSimpleJWT`/`hmacSha256` dihapus total). **Anda WAJIB men-deploy Edge Function `auth-login`** (lihat Langkah 2 di atas) — tanpa itu, login akan gagal dengan pesan yang jelas alih-alih diam-diam memakai jalur yang tidak aman.

---

## Security Hardening — Ronde 3 (Audit Senior Developer)

| # | Level | Masalah | Perbaikan |
|---|---|---|---|
| 1 | **CRITICAL** | RLS policy `"public read settings view"` pada tabel **`settings`** (bukan pada view-nya) diberi `to authenticated using (true)` — artinya **operator biasa (bukan super_admin) bisa membaca tabel settings mentah langsung**, termasuk `groq_api_key` yang asli, sepenuhnya melewati view `public_settings` yang seharusnya menyamarkannya. `js/chat.js` bahkan memanggil `Api.getSettingsRaw()` lebih dulu untuk SEMUA user (fallback ke versi masked hanya jika gagal) — jadi API key Groq bisa dicuri operator lewat DevTools (`await Api.getSettingsRaw()`). | Policy diganti jadi `to authenticated using (current_user_role() = 'super_admin')`. View `public_settings` tetap bisa diakses semua orang (view berjalan dengan privilese pemilik, bukan pemanggil) sehingga masih berfungsi menyamarkan key untuk non-super-admin. |
| 2 | **HIGH** | CSP (`script-src` tanpa `'unsafe-inline'`) memblokir inline event handler — tapi `tabs.js` (modal) dan `chat.js` (widget chat) memakai `onclick="event.stopPropagation()"` inline. Browser modern akan **diam-diam mengabaikan** handler ini, sehingga klik di mana pun di dalam modal/chat (termasuk pada input/tombol) langsung menutup modal/chat karena event bubbling ke overlay. Ini membuat hampir semua form di dashboard (tambah/edit data, kategori, user, ganti password, dll) berpotensi tidak bisa dipakai di browser yang menegakkan CSP dengan ketat. | `onclick` inline dihapus, diganti `addEventListener('click', e => e.stopPropagation())` yang tidak diblokir CSP. |
| 3 | **MEDIUM** | Nilai `color` kategori (diisi lewat color-picker, hanya oleh super_admin) dirender langsung ke atribut `style="background: ${cat.color}"` di **halaman publik** (`public.js`) maupun dashboard (`tabs.js`) tanpa validasi. Jika field ini pernah berisi nilai selain hex color (data rusak, bug lain, atau sesi admin yang diretas), payload bisa lolos ke setiap pengunjung publik. | Ditambahkan `safeColor()` yang memvalidasi format `#rgb`/`#rrggbb` sebelum dipakai di `style=`, fallback ke warna default jika tidak valid. Diterapkan di semua titik render warna kategori. |
| 4 | **LOW** | Kode CSRF token (`generateCsrfToken`/`getCsrfToken`) di `auth.js` **dibuat tapi tak pernah benar-benar dikirim atau diverifikasi di mana pun** — token digenerate lalu tidak pernah dilampirkan ke request apa pun. README bahkan mengklaimnya sebagai proteksi aktif ("CSRF token ... included as custom header"), padahal tidak. Ini fake security yang menyesatkan developer berikutnya. Secara arsitektur, CSRF klasik juga tidak relevan di sini karena sesi memakai Bearer token yang dilampirkan manual oleh JS milik aplikasi sendiri (bukan cookie ambient yang otomatis dikirim browser ke request lintas situs). | Kode CSRF yang tidak terpakai dihapus seluruhnya (fungsi, config key, export). Dokumentasi diperbaiki agar tidak mengklaim proteksi yang sebenarnya tidak ada. |
| 5 | **LOW** | Link `target="_blank"` (halaman publik dari dashboard, link Groq) tanpa `rel="noopener noreferrer"` — halaman tujuan bisa memakai `window.opener` untuk reverse-tabnabbing. | Ditambahkan `rel="noopener noreferrer"` pada kedua link. |

---

## Compute SRI Hashes (Before Deployment)

SRI hashes in HTML files are placeholders (`sha384-{COMPUTE_HASH}`). All CDN scripts are now pinned to exact versions (never a floating tag like `@2`, which can change its bytes without you ever updating the SRI hash). Compute the real hashes before deploying:

```bash
# For each CDN script (URLs must match exactly what's in the HTML <script src>):
curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.52.1/dist/umd/supabase.js | openssl dgst -sha384 -binary | openssl base64 -A
curl -s https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js | openssl dgst -sha384 -binary | openssl base64 -A
curl -s https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js | openssl dgst -sha384 -binary | openssl base64 -A

# Then replace `sha384-{COMPUTE_HASH}` with `sha384-REAL_HASH` in each HTML file
```

If you later bump any of these versions, you MUST recompute and update the corresponding SRI hash — otherwise the browser will refuse to load the script (fails safe) rather than silently skip the integrity check.

---

## Fitur

### Halaman Publik (`index.html`)
- Peta Leaflet dengan 14 marker kecamatan
- Warna marker berdasarkan tingkat risiko (Stunting): rendah/sedang/tinggi
- Popup detail per kecamatan (klik marker)
- Tanggal update terakhir per kasus
- Tombol "Tanya AI" — chat widget AI Groq (publik, tidak perlu login)
- Header formal pemerintahan dengan lambang Kab. Indragiri Hulu

### Halaman Login (`login.html`)
- Login terpisah (tidak di halaman depan)
- Menggunakan SQL function `verify_login` (password di-hash dengan bcrypt)
- **Rate limiting**: 5 percobaan gagal → lockout 15 menit (client + server side)
- **Session expiry**: 24 jam (diperbarui dari 7 hari)
- **No exposed credentials**: kredensial tidak ditampilkan di halaman

### Dashboard Admin (`dashboard.html`)
Setelah login, dashboard memiliki 7 tab:
1. **📋 Data Kasus** — CRUD data kasus per kecamatan/kategori/subkategori
2. **🗂️ Kategori & Subkategori** (Super Admin only)
3. **🗺️ Kecamatan** — CRUD kecamatan + koordinat
4. **👥 Manajemen User** (Super Admin only) — dengan password strength indicator
5. **📊 Import / Export Excel**
6. **🤖 AI Chat** — Chat internal admin dengan database
7. **⚙️ Pengaturan** (Super Admin only)

---

## Troubleshooting

### "Gagal memuat data peta"
- Pastikan Anda sudah menjalankan `sql/schema_secure.sql` di Supabase SQL Editor
- Cek koneksi internet (Supabase butuh internet)
- Buka Developer Tools (F12) → Console untuk lihat error detail

### "Email atau password salah"
- Hubungi Super Admin untuk kredensial
- Pastikan tidak ada spasi sebelum/sesudah email
- Jika lupa password, reset via SQL (hubungi administrator)

### "Terlalu banyak percobaan login gagal"
- Anda telah melewati batas 5 percobaan gagal
- Tunggu 15 menit atau reset via SQL: `select * from clear_login_attempts('email@domain')`

### "API Key Groq belum dikonfigurasi"
- Login sebagai super admin → tab Pengaturan → isi Groq API Key
- Dapatkan API key gratis di https://console.groq.com/keys

### Edge Function CORS error
- Edit `ALLOWED_ORIGINS` di `supabase-functions/chat/index.ts` dengan domain Anda
- Re-deploy: `supabase functions deploy chat --no-verify-jwt`

---

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6+), Leaflet.js
- **Database**: Supabase (PostgreSQL) dengan RLS — HARDENED
- **AI**: Groq API (llama-3.3-70b-versatile) — via Edge Function (CORS restricted)
- **Excel**: SheetJS (xlsx) — client-side
- **Auth**: pgcrypto (bcrypt) + custom JWT + rate limiting + session fingerprinting
- **Security**: CSP, SRI, XSS sanitization, safe error messages, audit logging, server-signed JWT sessions (no CSRF token needed — auth uses a manually-attached Bearer token, not an ambient cookie)

© Dinas Kesehatan · Pemerintah Kabupaten Indragiri Hulu
