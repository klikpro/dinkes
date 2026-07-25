/**
 * auth.js — Manajemen sesi pengguna
 *
 * Strategi:
 * - Login memanggil SQL function `verify_login(email, password)` via Supabase RPC
 * - SQL function mengembalikan data user jika password cocok (pakai pgcrypto crypt)
 * - Sesi disimpan di localStorage dengan timestamp
 * - Custom JWT dibuat client-side (HMAC SHA-256) untuk dikirim sebagai Bearer token
 *   ke Supabase. JWT berisi user_metadata: { user_id, role }.
 *
 * CATATAN KEAMANAN:
 * JWT ini ditandatangani dengan anon key Supabase sebagai secret. Ini BUKAN
 * solusi keamanan yang kuat — ini hanya untuk identifikasi user di sisi client.
 * Keamanan sebenarnya dipegang oleh RLS policies di database.
 * Untuk keamanan tingkat produksi, gunakan Supabase Auth bawaan atau Edge Function.
 */

/**
 * Login dengan email + password.
 * Mengembalikan { user, token } jika sukses, atau throw Error jika gagal.
 */
async function login(email, password) {
  const { data, error } = await sb.rpc('verify_login', {
    p_email: email,
    p_password: password,
  })
  if (error) throw new Error('Gagal memverifikasi login: ' + error.message)
  if (!data || data.length === 0) {
    throw new Error('Email atau password salah')
  }
  const user = data[0]
  if (!user.is_active) {
    throw new Error('Akun Anda dinonaktifkan. Hubungi Super Admin.')
  }

  // Buat custom JWT untuk dikirim sebagai Bearer token ke Supabase
  // Format: header.payload.signature (HMAC SHA-256 dengan anon key)
  const token = await createSimpleJWT({
    user_id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  })

  // Simpan sesi
  const session = {
    user,
    token,
    expiresAt: Date.now() + window.CONFIG.SESSION_MAX_AGE_MS,
  }
  localStorage.setItem(window.CONFIG.SESSION_KEY, JSON.stringify(session))

  // Set auth header untuk Supabase client
  setSupabaseAuth(token)

  return session
}

/**
 * Logout: hapus sesi dari localStorage.
 */
function logout() {
  localStorage.removeItem(window.CONFIG.SESSION_KEY)
  // Reset Supabase auth headers
  if (window.sb) {
    sb.rest.headers = {
      apikey: window.CONFIG.SUPABASE_ANON_KEY,
    }
  }
}

/**
 * Ambil sesi saat ini dari localStorage.
 * Mengembalikan null jika tidak ada atau sudah kedaluwarsa.
 */
function getSession() {
  try {
    const raw = localStorage.getItem(window.CONFIG.SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    if (!session.expiresAt || Date.now() > session.expiresAt) {
      logout()
      return null
    }
    return session
  } catch (e) {
    return null
  }
}

/**
 * Ambil user saat ini, atau null jika belum login.
 */
function getCurrentUser() {
  const session = getSession()
  return session ? session.user : null
}

/**
 * Pastikan user sudah login. Jika belum, redirect ke login.html.
 * Mengembalikan user jika sudah login.
 */
function requireAuth() {
  const user = getCurrentUser()
  if (!user) {
    window.location.href = 'login.html'
    return null
  }
  // Pastikan Supabase client pakai token dari sesi
  const session = getSession()
  if (session) setSupabaseAuth(session.token)
  return user
}

/**
 * Pastikan user adalah super admin. Jika bukan, tampilkan pesan error.
 */
function requireSuperAdmin() {
  const user = requireAuth()
  if (!user) return null
  if (user.role !== 'super_admin') {
    alert('Akses ditolak. Halaman ini hanya untuk Super Admin.')
    window.location.href = 'dashboard.html'
    return null
  }
  return user
}

/**
 * Buat simple JWT (HMAC SHA-256) untuk dikirim ke Supabase.
 * Supabase akan memverifikasi signature dengan JWT secret project.
 * Karena anon key adalah JWT secret yang dipakai untuk signing,
 * kita pakai anon key sebagai HMAC secret.
 *
 * Catatan: Supabase sebenarnya memverifikasi JWT dengan service-level JWT secret,
 * bukan anon key. Jadi JWT ini akan diterima sebagai "anon" role oleh Supabase.
 * Untuk RLS berbasis role user, kita andalkan user_metadata di JWT.
 */
async function createSimpleJWT(payload) {
  // Header
  const header = { alg: 'HS256', typ: 'JWT' }
  // Payload dengan iat dan exp
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = {
    ...payload,
    iss: 'supabase',
    ref: 'aqxllawmskworpovcofq',
    role: 'authenticated', // supaya RLS authenticated policy berlaku
    iat: now,
    exp: now + 7 * 24 * 3600,
    aud: 'authenticated',
    user_metadata: {
      user_id: payload.user_id,
      email: payload.email,
      role: payload.role,
      name: payload.name,
    },
    app_metadata: {
      role: payload.role,
      user_id: payload.user_id,
    },
  }

  // Encode header and payload
  const encHeader = base64UrlEncode(JSON.stringify(header))
  const encPayload = base64UrlEncode(JSON.stringify(fullPayload))
  const signingInput = `${encHeader}.${encPayload}`

  // Sign with anon key as HMAC SHA-256 secret
  // NOTE: This JWT will NOT pass Supabase's JWT signature verification
  // (which uses the project's JWT secret, not the anon key).
  // Instead, we send it as a custom Authorization header and let Supabase
  // treat the request as "anonymous" but with our metadata visible via
  // current_user_id() / current_user_role() helper functions.
  // For real security, use Supabase Auth or an Edge Function.
  const secret = window.CONFIG.SUPABASE_ANON_KEY
  const signature = await hmacSha256(signingInput, secret)

  return `${signingInput}.${signature}`
}

function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmacSha256(message, secret) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  let bin = ''
  new Uint8Array(sig).forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

window.login = login
window.logout = logout
window.getSession = getSession
window.getCurrentUser = getCurrentUser
window.requireAuth = requireAuth
window.requireSuperAdmin = requireSuperAdmin
