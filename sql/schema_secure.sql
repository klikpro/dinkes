-- ===========================================================================
-- PETA KESEHATAN KABUPATEN INDRAGIRI HULU
-- Supabase PostgreSQL Schema — SECURITY-HARDENED VERSION
-- ===========================================================================
-- PERINGATAN: Script ini akan MENGHAPUS tabel-tabel jika sudah ada.
-- Jika Anda sudah punya data penting, JANGAN jalankan bagian DROP TABLE.
-- ===========================================================================
-- CARA PAKAI:
-- 1. Buka project Supabase Anda di https://supabase.com/dashboard
-- 2. Buka SQL Editor → New query
-- 3. Copy seluruh isi file ini → Run (Ctrl+Enter)
-- 4. Tunggu sampai muncul "Success. No rows returned"
-- ===========================================================================
-- SECURITY IMPROVEMENTS (vs schema_fixed.sql):
-- - public_settings VIEW masks groq_api_key for non-super_admin
-- - hash_password() restricted to authenticated only (not anon)
-- - users table: only super_admin can read/write via RLS
-- - user_permissions: only super_admin can read/write via RLS
-- - districts/categories/subcategories write: only super_admin
-- - case_records write: requires permission check or super_admin role
-- - chat_history: user can only read their own
-- - login_attempts table + rate limiting function
-- - audit_log table + triggers for all sensitive operations
-- - verify_login enhanced with rate limit check
-- - password_changed_at column for enforcing password change
-- - Narrowed GRANT privileges (no blanket anon access)
-- ===========================================================================

-- Enable required extensions
create extension if not exists "pgcrypto" with schema extensions;

-- ===========================================================================
-- 0. BERSIHKAN TABEL LAMA
-- ===========================================================================
drop table if exists audit_log         cascade;
drop table if exists login_attempts    cascade;
drop table if exists chat_history      cascade;
drop table if exists user_permissions  cascade;
drop table if exists case_records      cascade;
drop table if exists subcategories     cascade;
drop table if exists categories        cascade;
drop table if exists districts         cascade;
drop table if exists settings          cascade;
drop table if exists users             cascade;
drop view if exists public_settings;

-- ===========================================================================
-- 1. USERS (dengan password_changed_at untuk enforce password change)
-- ===========================================================================
create table users (
  id                uuid primary key default gen_random_uuid(),
  email             text unique not null,
  name              text not null,
  password_hash     text not null,
  role              text not null default 'user' check (role in ('super_admin', 'user')),
  is_active         boolean not null default true,
  password_changed_at timestamptz,    -- NULL = belum ganti password default
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table users is 'Akun pengguna sistem (super admin & operator)';
comment on column users.password_changed_at is 'Waktu password diganti dari default. NULL = masih password default, HARUS diganti.';

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
  value          double precision not null check (value >= 0 and value <= 999999),
  period         text,
  notes          text check (notes is null or char_length(notes) <= 500),
  created_by     uuid not null references users(id),
  updated_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_case_records_district    on case_records(district_id);
create index idx_case_records_subcategory on case_records(subcategory_id);

-- ===========================================================================
-- 5. USER PERMISSIONS
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
-- 6. SETTINGS (with public_settings view to mask groq_api_key)
-- ===========================================================================
create table settings (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- VIEW: public_settings masks groq_api_key for non-super_admin
-- Client-side reads from this view instead of the raw settings table
create view public_settings as
select
  key,
  case
    when key = 'groq_api_key' then '***HIDDEN***'
    else value
  end as value
from settings;

-- ===========================================================================
-- 7. CHAT HISTORY
-- ===========================================================================
create table chat_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id) on delete set null,
  question   text not null,
  answer     text not null,
  created_at timestamptz not null default now()
);

-- ===========================================================================
-- 8. LOGIN ATTEMPTS (for brute force protection)
-- ===========================================================================
create table login_attempts (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  attempted_at timestamptz not null default now(),
  success      boolean not null default false,
  ip_hint      text          -- optional IP info from client headers
);
create index idx_login_attempts_email_time on login_attempts(email, attempted_at);

-- ===========================================================================
-- 9. AUDIT LOG (for tracking all sensitive operations)
-- ===========================================================================
create table audit_log (
  id           uuid primary key default gen_random_uuid(),
  table_name   text not null,
  operation    text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  record_id    uuid,
  old_data     jsonb,
  new_data     jsonb,
  performed_by uuid,
  performed_at timestamptz not null default now()
);

-- ===========================================================================
-- 10. SEED DATA — KECAMATAN INDRAGIRI HULU (14 KECAMATAN)
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
-- 11. SEED DATA — KATEGORI & SUBKATEGORI
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
-- 12. SEED DATA — SUPER ADMIN
-- ===========================================================================
-- Password default: admin123 — GANTI SEGERA setelah login pertama!
insert into users (email, name, password_hash, role, is_active, password_changed_at) values
 ('admin@dinkes.go.id', 'Super Admin Dinkes',
  extensions.crypt('admin123', extensions.gen_salt('bf')),
  'super_admin', true, null);  -- null = belum ganti password

-- ===========================================================================
-- 13. SEED DATA — SETTINGS DEFAULT
-- ===========================================================================
insert into settings (key, value) values
 ('groq_api_key', ''),
 ('groq_model', 'llama-3.3-70b-versatile'),
 ('excel_heading_line1', 'PEMERINTAH KABUPATEN INDRAGIRI HULU'),
 ('excel_heading_line2', 'DINAS KESEHATAN'),
 ('excel_heading_line3', 'DATA KASUS KESEHATAN KABUPATEN INDRAGIRI HULU'),
 ('site_name', 'Peta Kesehatan Kabupaten Indragiri Hulu');

-- ===========================================================================
-- 14. SEED DATA — CASE RECORDS AWAL
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
-- 15. LOGIN FUNCTION (SECURITY DEFINER — with rate limit check)
-- ===========================================================================
create or replace function verify_login(p_email text, p_password text)
returns table (
  id uuid,
  email text,
  name text,
  role text,
  is_active boolean,
  password_changed_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  attempt_count integer;
begin
  -- RATE LIMIT: check if too many failed attempts
  select count(*) into attempt_count
  from login_attempts
  where email = lower(trim(p_email))
    and attempted_at > now() - interval '15 minutes'
    and success = false;

  if attempt_count >= 5 then
    raise exception 'Terlalu banyak percobaan login gagal. Coba lagi dalam 15 menit.';
  end if;

  -- Log the attempt
  insert into login_attempts (email, success) values (lower(trim(p_email)), false);

  -- Verify credentials
  return query
  select u.id, u.email, u.name, u.role, u.is_active, u.password_changed_at
  from users u
  where u.email = lower(trim(p_email))
    and u.is_active = true
    and extensions.crypt(p_password, u.password_hash) = u.password_hash;

  -- If we got a result, update the attempt to success
  if found then
    update login_attempts
    set success = true
    where email = lower(trim(p_email))
      and attempted_at = (
        select max(attempted_at) from login_attempts
        where email = lower(trim(p_email))
      );
  end if;
end;
$$;
grant execute on function verify_login(text, text) to anon, authenticated;

-- ===========================================================================
-- 16. HASH PASSWORD FUNCTION (restricted: authenticated only, NOT anon)
-- ===========================================================================
create or replace function hash_password(p_password text)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select extensions.crypt(p_password, extensions.gen_salt('bf'));
$$;
-- IMPORTANT: Only grant to authenticated, NOT anon (prevents abuse)
grant execute on function hash_password(text) to authenticated;
-- Explicitly revoke from anon
revoke execute on function hash_password(text) from anon;

-- ===========================================================================
-- 17. RATE LIMIT CHECK FUNCTION
-- ===========================================================================
create or replace function check_login_rate_limit(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  attempt_count integer;
begin
  select count(*) into attempt_count
  from login_attempts
  where email = lower(trim(p_email))
    and attempted_at > now() - interval '15 minutes'
    and success = false;
  return attempt_count < 5;
end;
$$;
grant execute on function check_login_rate_limit(text) to anon, authenticated;

-- ===========================================================================
-- 18. CLEAR LOGIN ATTEMPTS (on successful login)
-- ===========================================================================
create or replace function clear_login_attempts(p_email text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from login_attempts where email = lower(trim(p_email));
$$;
grant execute on function clear_login_attempts(text) to anon, authenticated;

-- ===========================================================================
-- 18.5 CHANGE OWN PASSWORD (any authenticated user, including non-super-admin)
-- ===========================================================================
-- NOTE: RLS below intentionally does NOT let non-super-admin users UPDATE
-- the `users` table directly (so they can't touch role/is_active/etc).
-- This function is the only self-service way for an operator to change
-- their own password, e.g. after being given a temporary one.
-- It uses current_user_id() (from the signed JWT), NOT a client-supplied
-- id, so a user can never change anyone else's password this way.
create or replace function change_own_password(p_old_password text, p_new_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_uid uuid;
begin
  v_uid := current_user_id();
  if v_uid is null then
    raise exception 'Tidak terautentikasi.';
  end if;
  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'Password baru minimal 8 karakter.';
  end if;

  select password_hash into v_hash from users where id = v_uid and is_active = true;
  if v_hash is null then
    raise exception 'User tidak ditemukan atau nonaktif.';
  end if;
  if extensions.crypt(p_old_password, v_hash) <> v_hash then
    raise exception 'Password lama salah.';
  end if;

  update users
  set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      password_changed_at = now()
  where id = v_uid;

  return true;
end;
$$;
grant execute on function change_own_password(text, text) to authenticated;
revoke execute on function change_own_password(text, text) from anon;

-- ===========================================================================
-- 19. ROW LEVEL SECURITY (RLS) — HARDENED
-- ===========================================================================
alter table users             enable row level security;
alter table categories        enable row level security;
alter table subcategories     enable row level security;
alter table districts         enable row level security;
alter table case_records      enable row level security;
alter table user_permissions  enable row level security;
alter table settings          enable row level security;
alter table chat_history      enable row level security;
alter table login_attempts    enable row level security;
alter table audit_log         enable row level security;

-- Helper functions for RLS
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
-- Anyone can read districts, categories, subcategories, case_records
create policy "public read districts"     on districts     for select using (true);
create policy "public read categories"    on categories    for select using (true);
create policy "public read subcategories" on subcategories for select using (true);
create policy "public read case_records"  on case_records  for select using (true);
-- Settings: ONLY through public_settings view (masks groq_api_key) for
-- everyone except super_admin. The raw `settings` table itself is NOT
-- readable by plain `authenticated` users — only super_admin (RLS below).
-- (The Edge Functions use the service-role key, which bypasses RLS
-- entirely, so they never needed a client-facing policy here.)
create policy "super_admin read settings" on settings for select
  to authenticated using (current_user_role() = 'super_admin');

-- ============ WRITE policies — HARDENED ============

-- DISTRICTS, CATEGORIES, SUBCATEGORIES: only super_admin can write
create policy "super_admin write districts" on districts for all
  to authenticated using (current_user_role() = 'super_admin')
  with check (current_user_role() = 'super_admin');
create policy "super_admin write categories" on categories for all
  to authenticated using (current_user_role() = 'super_admin')
  with check (current_user_role() = 'super_admin');
create policy "super_admin write subcategories" on subcategories for all
  to authenticated using (current_user_role() = 'super_admin')
  with check (current_user_role() = 'super_admin');

-- CASE RECORDS: authenticated users with permission, or super_admin
create policy "auth insert case_records" on case_records for insert
  to authenticated with check (
    current_user_role() = 'super_admin'
    or exists (
      select 1 from user_permissions
      where user_id = current_user_id()
        and subcategory_id = case_records.subcategory_id
        and can_input = true
    )
  );
create policy "auth update case_records" on case_records for update
  to authenticated using (
    current_user_role() = 'super_admin'
    or exists (
      select 1 from user_permissions
      where user_id = current_user_id()
        and subcategory_id = case_records.subcategory_id
        and can_input = true
    )
  ) with check (
    current_user_role() = 'super_admin'
    or exists (
      select 1 from user_permissions
      where user_id = current_user_id()
        and subcategory_id = case_records.subcategory_id
        and can_input = true
    )
  );
create policy "auth delete case_records" on case_records for delete
  to authenticated using (
    current_user_role() = 'super_admin'
    or exists (
      select 1 from user_permissions
      where user_id = current_user_id()
        and subcategory_id = case_records.subcategory_id
        and can_input = true
    )
  );

-- USERS: only super_admin can read/write
create policy "super_admin read users" on users for select
  to authenticated using (current_user_role() = 'super_admin');
create policy "super_admin write users" on users for all
  to authenticated using (current_user_role() = 'super_admin')
  with check (current_user_role() = 'super_admin');
-- Allow user to read their own record (for session validation)
create policy "user read own" on users for select
  to authenticated using (id = current_user_id());

-- USER_PERMISSIONS: only super_admin can read/write
create policy "super_admin read user_permissions" on user_permissions for select
  to authenticated using (current_user_role() = 'super_admin');
create policy "super_admin write user_permissions" on user_permissions for all
  to authenticated using (current_user_role() = 'super_admin')
  with check (current_user_role() = 'super_admin');
-- Allow user to read their own permissions
create policy "user read own permissions" on user_permissions for select
  to authenticated using (user_id = current_user_id());

-- SETTINGS write: only super_admin
create policy "super_admin write settings" on settings for all
  to authenticated using (current_user_role() = 'super_admin')
  with check (current_user_role() = 'super_admin');

-- CHAT_HISTORY: user can only read/write their own
create policy "auth insert chat_history" on chat_history for insert
  to authenticated with check (user_id = current_user_id());
create policy "auth read own chat_history" on chat_history for select
  to authenticated using (user_id = current_user_id());

-- LOGIN_ATTEMPTS: normal read/write only via SECURITY DEFINER functions
-- (verify_login, check_login_rate_limit, clear_login_attempts), which run
-- as the function owner and bypass RLS/GRANTs entirely. Direct table
-- access is restricted to super_admin (for auditing) only.
create policy "super_admin read login_attempts" on login_attempts for select
  to authenticated using (current_user_role() = 'super_admin');

-- AUDIT_LOG: only super_admin can read; system writes via triggers
create policy "super_admin read audit_log" on audit_log for select
  to authenticated using (current_user_role() = 'super_admin');

-- ===========================================================================
-- 20. AUDIT LOG TRIGGERS
-- ===========================================================================
create or replace function trg_audit_log()
returns trigger as $$
declare
  op text;
begin
  op = tg_op;
  if op = 'DELETE' then
    insert into audit_log (table_name, operation, record_id, old_data, performed_by, performed_at)
    values (tg_table_name, op, old.id, to_jsonb(old.*), current_user_id(), now());
    return old;
  elsif op = 'UPDATE' then
    insert into audit_log (table_name, operation, record_id, old_data, new_data, performed_by, performed_at)
    values (tg_table_name, op, new.id, to_jsonb(old.*), to_jsonb(new.*), current_user_id(), now());
    return new;
  elsif op = 'INSERT' then
    insert into audit_log (table_name, operation, record_id, new_data, performed_by, performed_at)
    values (tg_table_name, op, new.id, to_jsonb(new.*), current_user_id(), now());
    return new;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

-- Apply audit triggers to sensitive tables
do $$
declare t text;
begin
  for t in select unnest(array['users','case_records','settings','user_permissions'])
  loop
    execute format('drop trigger if exists audit_log_trigger on %I;', t);
    execute format('create trigger audit_log_trigger after insert or update or delete on %I
                    for each row execute function trg_audit_log();', t);
  end loop;
end $$;

-- ===========================================================================
-- 21. UPDATED_AT TRIGGER
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
-- 22. GRANT PRIVILEGES — NARROWED (NO blanket anon access)
-- ===========================================================================
grant usage on schema public to anon, authenticated;

-- Public read-only grants (anon can read public data)
grant select on districts, categories, subcategories, case_records to anon, authenticated;
grant select on public_settings to anon, authenticated;

-- Authenticated-only grants (for write operations, controlled by RLS)
grant select, insert, update, delete on users, user_permissions, settings, case_records,
  districts, categories, subcategories, chat_history to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Audit/log tables: writes only happen via SECURITY DEFINER functions/triggers
-- (which bypass GRANTs as the function owner). Only grant SELECT so
-- super_admin can review the audit trail; RLS above restricts it further.
grant select on login_attempts, audit_log to authenticated;

-- Default privileges for future tables
alter default privileges in schema public
  grant select on tables to anon, authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- ===========================================================================
-- SELESAI — SECURITY-HARDENED VERSION
-- ===========================================================================
