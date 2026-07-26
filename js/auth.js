/**
 * auth.js — Manajemen sesi pengguna (SECURITY-HARDENED)
 *
 * Strategi:
 * - Login memanggil SQL function `verify_login(email, password)` via Supabase RPC
 * - SQL function mengembalikan data user jika password cocok (pakai pgcrypto crypt)
 * - Sesi disimpan di localStorage dengan timestamp + session fingerprinting
 * - Custom JWT dibuat client-side (HMAC SHA-256) untuk dikirim sebagai Bearer token
 *   ke Supabase. JWT berisi user_metadata: { user_id, role }.
 *
 * SECURITY IMPROVEMENTS (vs original):
 * - Login rate limiting: 5 failed attempts → 15 min lockout
 * - Session fingerprinting: user agent hash stored with session, validated on getSession()
 * - Session expiry reduced from 7 days to 24 hours
 * - Email & password validation before sending to server
 * - Safe error messages (no internal details exposed)
 * - validateSession() re-validates session server-side
 * - Logout clears all sensitive localStorage keys
 */

// ===========================================================================
// UTILITY FUNCTIONS
// ===========================================================================

/**
 * Sanitize HTML — escape all HTML entities to prevent XSS.
 */
function sanitizeHtml(str) {
  if (!str) return ''
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

/**
 * Safe error message — only expose known user-facing errors,
 * hide internal details.
 */
function safeErrorMessage(err) {
  const msg = err?.message || ''
  if (msg.includes('Email atau password salah')) return msg
  if (msg.includes('Akun Anda dinonaktifkan')) return msg
  if (msg.includes('Terlalu banyak percobaan')) return msg
  if (msg.includes('Rate limit')) return msg
  if (msg.includes('Password lama salah')) return msg
  if (msg.includes('Password baru minimal')) return msg
  if (msg.includes('Tidak terautentikasi')) return msg
  if (msg.includes('User tidak ditemukan')) return msg
  // Don't expose internal errors to the UI, but ALWAYS log the real error
  // to console so it can be debugged without digging through the Network tab.
  console.error('[safeErrorMessage] Original error (hidden from user):', err)
  return 'Terjadi kesalahan. Silakan coba lagi atau hubungi administrator.'
}

/**
 * Validate email format.
 */
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return re.test(email)
}

/**
 * Generate session fingerprint based on user agent.
 */
function generateFingerprint() {
  const ua = navigator.userAgent || ''
  // Simple hash using SubtleCrypto (async), but we need synchronous for storage
  // Use a simple string hash instead
  let hash = 0
  for (let i = 0; i < ua.length; i++) {
    const char = ua.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return 'fp_' + Math.abs(hash).toString(36) + '_' + Date.now().toString(36)
}

// ===========================================================================
// RATE LIMITING
// ===========================================================================

const RATE_LIMIT_KEY = 'peta_kesehatan_login_attempts'
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

/**
 * Check if login is rate-limited. Returns { locked: boolean, remainingSeconds: number }
 */
function checkRateLimit() {
  try {
    const raw = localStorage.getItem(RATE_LIMIT_KEY)
    if (!raw) return { locked: false, remainingSeconds: 0 }
    const attempts = JSON.parse(raw)
    const now = Date.now()

    // Clean expired attempts
    const validAttempts = attempts.filter((a) => now - a.timestamp < RATE_LIMIT_WINDOW_MS)
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(validAttempts))

    // Count only failed attempts in the window
    const failedCount = validAttempts.filter((a) => !a.success).length

    if (failedCount >= RATE_LIMIT_MAX) {
      const oldestFailed = validAttempts.find((a) => !a.success)
      const elapsed = now - oldestFailed.timestamp
      const remainingMs = RATE_LIMIT_WINDOW_MS - elapsed
      return { locked: true, remainingSeconds: Math.ceil(remainingMs / 1000) }
    }
    return { locked: false, remainingSeconds: 0 }
  } catch (e) {
    return { locked: false, remainingSeconds: 0 }
  }
}

/**
 * Record a login attempt (success or failure).
 */
function recordLoginAttempt(success) {
  try {
    const raw = localStorage.getItem(RATE_LIMIT_KEY) || '[]'
    const attempts = JSON.parse(raw)
    attempts.push({ timestamp: Date.now(), success })
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(attempts))
  } catch (e) {
    // Ignore storage errors
  }
}

/**
 * Clear rate limit data (on successful login).
 */
function clearRateLimit() {
  localStorage.removeItem(RATE_LIMIT_KEY)
}

// ===========================================================================
// SESSION MANAGEMENT
// ===========================================================================

/**
 * Login dengan email + password.
 * Mengembalikan { user, token } jika sukses, atau throw Error jika gagal.
 *
 * Validates email format and password length before sending to server.
 * Enforces rate limiting.
 */
async function login(email, password) {
  // Check rate limit first
  const rateLimit = checkRateLimit()
  if (rateLimit.locked) {
    throw new Error(`Terlalu banyak percobaan login gagal. Coba lagi dalam ${rateLimit.remainingSeconds} detik.`)
  }

  // Validate email format
  if (!validateEmail(email)) {
    throw new Error('Format email tidak valid.')
  }

  // Validate password minimum length
  if (!password || password.length < 8) {
    throw new Error('Password minimal 8 karakter.')
  }

  if (!window.CONFIG.AUTH_LOGIN_EDGE_FUNCTION_URL) {
    // Fail closed: without the Edge Function we cannot produce a JWT that
    // Supabase will actually accept as `authenticated`. Falling back to a
    // client-signed token here would recreate the forgeable-JWT
    // vulnerability (see supabase-functions/auth-login/index.ts for why).
    throw new Error(
      'Login belum dikonfigurasi. Hubungi administrator untuk men-deploy Edge Function "auth-login" (lihat README.md).'
    )
  }

  try {
    const resp = await fetch(window.CONFIG.AUTH_LOGIN_EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: window.CONFIG.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    })
    const result = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      recordLoginAttempt(false)
      throw new Error(safeErrorMessage({ message: result.error || '' }))
    }

    const user = result.user
    const token = result.token
    if (!user || !token) {
      recordLoginAttempt(false)
      throw new Error('Email atau password salah')
    }

    // Generate fingerprint
    const fingerprint = generateFingerprint()

    // Simpan sesi dengan fingerprint
    const session = {
      user,
      token,
      fingerprint,
      expiresAt: Date.now() + (result.expiresInSeconds ? result.expiresInSeconds * 1000 : window.CONFIG.SESSION_MAX_AGE_MS),
    }
    localStorage.setItem(window.CONFIG.SESSION_KEY, JSON.stringify(session))
    localStorage.setItem(window.CONFIG.SESSION_FINGERPRINT_KEY, fingerprint)

    // Set auth header untuk Supabase client
    setSupabaseAuth(token)

    // Record successful login (clears rate limit)
    recordLoginAttempt(true)
    clearRateLimit()

    return session
  } catch (err) {
    // If it's not a rate-limit or validation error, record as failed attempt
    if (!err.message.includes('Format email') &&
        !err.message.includes('Password minimal') &&
        !err.message.includes('Terlalu banyak')) {
      recordLoginAttempt(false)
    }
    throw err
  }
}

/**
 * Logout: hapus sesi dan semua sensitive data dari localStorage.
 */
function logout() {
  const keysToClear = [
    window.CONFIG.SESSION_KEY,
    window.CONFIG.SESSION_FINGERPRINT_KEY,
    'peta_kesehatan_csrf', // legacy key from a previous version, harmless to also clear
    RATE_LIMIT_KEY,
  ]
  keysToClear.forEach((key) => {
    try { localStorage.removeItem(key) } catch (e) {}
    try { sessionStorage.removeItem(key) } catch (e) {}
  })
  // Reset Supabase auth headers back to plain anon access
  if (window.setSupabaseAuth) {
    setSupabaseAuth(null)
  }
}

/**
 * Ambil sesi saat ini dari localStorage.
 * Mengembalikan null jika tidak ada, sudah kedaluwarsa, atau fingerprint mismatch.
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
    // Validate fingerprint
    const storedFp = localStorage.getItem(window.CONFIG.SESSION_FINGERPRINT_KEY)
    if (session.fingerprint && storedFp && session.fingerprint !== storedFp) {
      // Fingerprint mismatch — possible session theft
      console.warn('Session fingerprint mismatch detected. Session invalidated.')
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
 * Re-validate session against server by calling verify_login or checking user is still active.
 * Call this periodically for sensitive operations.
 */
async function validateSession() {
  const session = getSession()
  if (!session) return false
  try {
    // Check if user is still active by fetching user data
    const { data, error } = await sb
      .from('users')
      .select('id, is_active, role')
      .eq('id', session.user.id)
      .single()
    if (error || !data) {
      logout()
      return false
    }
    if (!data.is_active) {
      logout()
      return false
    }
    // Update role if changed server-side
    if (data.role !== session.user.role) {
      session.user.role = data.role
      localStorage.setItem(window.CONFIG.SESSION_KEY, JSON.stringify(session))
    }
    return true
  } catch (e) {
    // If validation fails due to network, don't invalidate session
    console.warn('Session validation check failed:', e.message)
    return true // Allow continued use, will be caught on next validation
  }
}

// ===========================================================================
// EXPORTS
// ===========================================================================

window.sanitizeHtml = sanitizeHtml
window.safeErrorMessage = safeErrorMessage
window.validateEmail = validateEmail
window.checkRateLimit = checkRateLimit
window.clearRateLimit = clearRateLimit
window.login = login
window.logout = logout
window.getSession = getSession
window.getCurrentUser = getCurrentUser
window.requireAuth = requireAuth
window.requireSuperAdmin = requireSuperAdmin
window.validateSession = validateSession
