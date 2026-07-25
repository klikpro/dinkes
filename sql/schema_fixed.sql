-- ===========================================================================
-- PETA KESEHATAN KABUPATEN INDRAGIRI HULU
-- Supabase PostgreSQL Schema (for static HTML site)
-- VERSI DIPERBAIKI: menambahkan DROP TABLE di awal agar semua tabel
-- dibuat ulang dari nol, sehingga constraint UNIQUE pasti terbentuk
-- dan tidak lagi error "42P10: no unique or exclusion constraint
-- matching the ON CONFLICT specification".
--
-- PERINGATAN: Script ini akan MENGHAPUS tabel-tabel di bawah ini jika
-- sudah ada (beserta semua datanya). Jika Anda sudah punya data penting
-- di tabel users/categories/case_records dll, JANGAN jalankan bagian
-- DROP TABLE ini — beri tahu saya dan saya buatkan versi yang aman
-- untuk data yang sudah ada.
-- ===========================================================================
-- CARA PAKAI:
-- 1. Buka project Supabase Anda di https://supabase.com/dashboard
-- 2. Buka SQL Editor → New query
-- 3. Copy seluruh isi file ini → Run (Ctrl+Enter)
-- 4. Tunggu sampai muncul "Success. No rows returned"
-- 5. Setelah itu, buka file index.html di browser → situs siap dipakai
-- ===========================================================================

-- Enable required extensions
create extension if not exists "pgcrypto" with schema extensions;

-- ===========================================================================
-- 0. BERSIHKAN TABEL LAMA (supaya constraint UNIQUE pasti dibuat ulang)
-- ===========================================================================
drop table if exists chat_history      cascade;
drop table if exists user_permissions  cascade;
drop table if exists case_records      cascade;
drop table if exists subcategories     cascade;
drop table if exists categories        cascade;
drop table if exists districts         cascade;
drop table if exists settings          cascade;
drop table if exists users             cascade;

-- ===========================================================================
-- 1. USERS
-- ===========================================================================
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  name          text not null,
  password_hash text not null,  -- bcrypt via pgcrypto's crypt()
  role          text not null default 'user' check (role in ('super_admin', 'user')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table users is 'Akun pengguna sistem (super admin & operator)';

-- ===========================================================================
-- 2. CATEGORIES & SUBCATEGORIES
-- ===========================================================================
create table categories (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,
  description text,
  icon        text,
  color       text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table subcategories (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  name        text not null,
  description text,
  unit        text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_subcategories_category_id on subcategories(category_id);

-- ===========================================================================
-- 3. DISTRICTS (KECAMATAN)
-- ===========================================================================
create table districts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  latitude   double precision not null,
  longitude  double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- 4. CASE RECORDS (DATA KASUS)
-- ===========================================================================
create table case_records (
  id             uuid primary key default gen_random_uuid(),
  district_id    uuid not null references districts(id) on delete cascade,
  subcategory_id uuid not null references subcategories(id) on delete cascade,
  value          double precision not null,
  period         text,
  notes          text,
  created_by     uuid not null references users(id),
  updated_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_case_records_district    on case_records(district_id);
create index idx_case_records_subcategory on case_records(subcategory_id);

-- ===========================================================================
-- 5. USER PERMISSIONS (HAK AKSES PER SUBKATEGORI)
-- ===========================================================================
create table user_permissions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  subcategory_id uuid not null references subcategories(id) on delete cascade,
  can_input      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, subcategory_id)
);
create index idx_user_permissions_user        on user_permissions(user_id);
create index idx_user_permissions_subcategory on user_permissions(subcategory_id);

-- ===========================================================================
-- 6. SETTINGS (GROQ API KEY, EXCEL HEADINGS, DLL)
-- ===========================================================================
create table settings (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- 7. CHAT HISTORY (AI GROQ)
-- ===========================================================================
create table chat_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id) on delete set null,
  question   text not null,
  answer     text not null,
  created_at timestamptz not null default now()
);

-- ===========================================================================
-- 8. SEED DATA — KECAMATAN INDRAGIRI HULU (14 KECAMATAN)
-- ===========================================================================
insert into districts (name, latitude, longitude) values
 ('Rengat',           -0.4053, 102.5606),
 ('Rengat Barat',     -0.3720, 102.4900),
 ('Kuala Cenaku',     -0.3300, 102.6700),
 ('Pasir Penyu',      -0.2500, 102.3800),
 ('Lirik',            -0.2300, 102.2900),
 ('Sungai Lala',      -0.1600, 102.2500),
 ('Rakit Kulim',      -0.1100, 102.1500),
 ('Batang Gansal',    -0.1500, 102.0300),
 ('Seberida',         -0.4800, 102.1200),
 ('Batang Cenaku',    -0.4300, 102.2200),
 ('Peranap',          -0.4000, 101.9200),
 ('Kelayang',         -0.3000, 102.5000),
 ('Lubuk Batu Jaya',  -0.2000, 102.4300),
 ('Batang Peranap',   -0.4600, 101.8000);

-- ===========================================================================
-- 9. SEED DATA — KATEGORI & SUBKATEGORI (3 KATEGORI AWAL)
-- ===========================================================================
insert into categories (name, description, icon, color, is_active, sort_order) values
 ('Penyakit Menular',     'Data kasus penyakit menular di Kabupaten Indragiri Hulu', 'virus', '#dc2626', true, 1),
 ('Kesehatan Ibu & Anak', 'Data ibu hamil, balita, dan stunting',                    'baby',  '#db2777', true, 2),
 ('Indikator Gizi',       'Indikator status gizi masyarakat',                        'apple', '#d97706', true, 3);

insert into subcategories (category_id, name, description, unit, is_active, sort_order)
select c.id, 'TB', 'Kasus TB aktif', 'orang', true, 1 from categories c where c.name='Penyakit Menular';

insert into subcategories (category_id, name, description, unit, is_active, sort_order)
select c.id, 'Ibu Hamil', 'Jumlah ibu hamil terdata', 'orang', true, 1 from categories c where c.name='Kesehatan Ibu & Anak';

insert into subcategories (category_id, name, description, unit, is_active, sort_order)
select c.id, 'Stunting', 'Kasus stunting balita', 'anak', true, 2 from categories c where c.name='Kesehatan Ibu & Anak';

-- ===========================================================================
-- 10. SEED DATA — SUPER ADMIN
-- ===========================================================================
-- Email:    admin@dinkes.go.id
-- Password: admin123
-- GANTI PASSWORD INI SEGERA setelah login pertama!
insert into users (email, name, password_hash, role, is_active) values
 ('admin@dinkes.go.id', 'Super Admin Dinkes',
  extensions.crypt('admin123', extensions.gen_salt('bf')),
  'super_admin', true);

-- ===========================================================================
-- 11. SEED DATA — SETTINGS DEFAULT
-- ===========================================================================
insert into settings (key, value) values
 ('groq_api_key', ''),
 ('groq_model', 'llama-3.3-70b-versatile'),
 ('excel_heading_line1', 'PEMERINTAH KABUPATEN INDRAGIRI HULU'),
 ('excel_heading_line2', 'DINAS KESEHATAN'),
 ('excel_heading_line3', 'DATA KASUS KESEHATAN KABUPATEN INDRAGIRI HULU'),
 ('site_name', 'Peta Kesehatan Kabupaten Indragiri Hulu');

-- ===========================================================================
-- 12. SEED DATA — CASE RECORDS AWAL (data dummy per kecamatan)
-- ===========================================================================
do $$
declare
  d record;
  tb_sub uuid;
  hamil_sub uuid;
  stunt_sub uuid;
  admin_id uuid;
begin
  select id into tb_sub    from subcategories where name = 'TB' limit 1;
  select id into hamil_sub from subcategories where name = 'Ibu Hamil' limit 1;
  select id into stunt_sub from subcategories where name = 'Stunting' limit 1;
  select id into admin_id  from users where email = 'admin@dinkes.go.id' limit 1;

  for d in select * from districts loop
    insert into case_records (district_id, subcategory_id, value, period, created_by, updated_by)
    values (d.id, tb_sub, 5 + (random() * 9), to_char(now(), 'YYYY-MM'), admin_id, admin_id);

    insert into case_records (district_id, subcategory_id, value, period, created_by, updated_by)
    values (d.id, hamil_sub, 58 + (random() * 100), to_char(now(), 'YYYY-MM'), admin_id, admin_id);

    insert into case_records (district_id, subcategory_id, value, period, created_by, updated_by)
    values (d.id, stunt_sub, 14 + (random() * 26), to_char(now(), 'YYYY-MM'), admin_id, admin_id);
  end loop;
end $$;

-- ===========================================================================
-- 13. LOGIN FUNCTION (SECURITY DEFINER — callable by anon)
-- ===========================================================================
create or replace function verify_login(p_email text, p_password text)
returns table (
  id uuid,
  email text,
  name text,
  role text,
  is_active boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  select u.id, u.email, u.name, u.role, u.is_active
  from users u
  where u.email = lower(trim(p_email))
    and u.is_active = true
    and extensions.crypt(p_password, u.password_hash) = u.password_hash;
end;
$$;
grant execute on function verify_login(text, text) to anon, authenticated;

-- ===========================================================================
-- 13b. HASH PASSWORD FUNCTION (callable by authenticated users)
-- ===========================================================================
create or replace function hash_password(p_password text)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select extensions.crypt(p_password, extensions.gen_salt('bf'));
$$;
grant execute on function hash_password(text) to anon, authenticated;

-- ===========================================================================
-- 14. ROW LEVEL SECURITY (RLS)
-- ===========================================================================
alter table users             enable row level security;
alter table categories        enable row level security;
alter table subcategories     enable row level security;
alter table districts         enable row level security;
alter table case_records      enable row level security;
alter table user_permissions  enable row level security;
alter table settings          enable row level security;
alter table chat_history      enable row level security;

create or replace function current_user_role()
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (auth.jwt() -> 'user_metadata' ->> 'role')::text,
    (auth.jwt() -> 'app_metadata' ->> 'role')::text,
    'anon'
  )
$$;
grant execute on function current_user_role() to anon, authenticated;

create or replace function current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select nullif(auth.jwt() -> 'user_metadata' ->> 'user_id', '')::uuid
$$;
grant execute on function current_user_id() to anon, authenticated;

-- ============ PUBLIC READ policies ============
create policy "public read districts"     on districts     for select using (true);
create policy "public read categories"    on categories    for select using (true);
create policy "public read subcategories" on subcategories for select using (true);
create policy "public read case_records"  on case_records  for select using (true);
create policy "public read settings"      on settings      for select using (true);

-- ============ WRITE policies for case_records ============
create policy "auth insert case_records" on case_records
  for insert to authenticated with check (true);
create policy "auth update case_records" on case_records
  for update to authenticated using (true) with check (true);
create policy "auth delete case_records" on case_records
  for delete to authenticated using (true);

-- ============ WRITE policies for districts/categories/subcategories ============
create policy "auth write districts"     on districts     for all to authenticated using (true) with check (true);
create policy "auth write categories"    on categories    for all to authenticated using (true) with check (true);
create policy "auth write subcategories" on subcategories for all to authenticated using (true) with check (true);

-- ============ USERS table policies ============
create policy "auth read users"  on users for select to authenticated using (true);
create policy "auth write users" on users for all      to authenticated using (true) with check (true);

-- ============ USER_PERMISSIONS table policies ============
create policy "auth read user_permissions"  on user_permissions for select to authenticated using (true);
create policy "auth write user_permissions" on user_permissions for all      to authenticated using (true) with check (true);

-- ============ SETTINGS write policy ============
create policy "auth write settings" on settings for all to authenticated using (true) with check (true);

-- ============ CHAT_HISTORY policies ============
create policy "auth insert chat_history" on chat_history
  for insert to authenticated with check (true);
create policy "auth read chat_history" on chat_history
  for select to authenticated using (true);

-- ===========================================================================
-- 15. UPDATED_AT TRIGGER (otomatis update kolom updated_at)
-- ===========================================================================
create or replace function trg_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  for t in select unnest(array[
    'users','categories','subcategories','districts',
    'case_records','user_permissions','settings'
  ])
  loop
    execute format('drop trigger if exists set_updated_at on %I;', t);
    execute format('create trigger set_updated_at before update on %I
                    for each row execute function trg_set_updated_at();', t);
  end loop;
end $$;

-- ===========================================================================
-- 16. GRANT PRIVILEGES
-- ===========================================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;

-- ===========================================================================
-- SELESAI
-- ===========================================================================
-- Setelah menjalankan SQL ini:
-- 1. Buka file index.html di browser (atau host di web server manapun)
-- 2. Untuk login admin: buka login.html
--    Email:    admin@dinkes.go.id
--    Password: admin123
-- 3. Setelah login, klik tombol "Dashboard" di pojok kanan atas
-- 4. Di menu Pengaturan, isi Groq API Key untuk mengaktifkan chat AI
--    (dapatkan gratis di https://console.groq.com/keys)
-- 5. Deploy Edge Function "chat" untuk keamanan API key Groq
--    (lihat README.md untuk instruksi)
-- ===========================================================================
