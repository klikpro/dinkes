/**
 * login.js — Logika halaman login (login.html) — SECURITY-HARDENED
 *
 * Improvements:
 * - Client-side email format validation before submit
 * - Client-side password minimum length (8 chars) validation
 * - Rate limiting UI: show lockout countdown when rate-limited
 * - Disable login button during lockout
 * - maxlength attributes on inputs
 * - Safe error messages (no internal details exposed)
 */

document.addEventListener('DOMContentLoaded', () => {
  initSupabase()

  // Jika sudah login, redirect ke dashboard
  if (getCurrentUser()) {
    window.location.href = 'dashboard.html'
    return
  }

  // Add maxlength attributes to inputs
  const emailInput = document.getElementById('email')
  const passInput = document.getElementById('password')
  emailInput.setAttribute('maxlength', '100')
  passInput.setAttribute('maxlength', '128')
  passInput.setAttribute('minlength', '8')

  // Check rate limit on load
  updateRateLimitUI()

  document.getElementById('loginForm').addEventListener('submit', handleLogin)
})

let lockoutTimer = null

function updateRateLimitUI() {
  const rateLimit = checkRateLimit()
  const btn = document.getElementById('loginBtn')
  const errDiv = document.getElementById('loginError')

  if (rateLimit.locked) {
    btn.disabled = true
    btn.textContent = `Tunggu ${rateLimit.remainingSeconds}s`
    errDiv.textContent = `Terlalu banyak percobaan login gagal. Coba lagi dalam ${rateLimit.remainingSeconds} detik.`
    errDiv.classList.remove('hidden')

    // Start countdown timer
    if (lockoutTimer) clearInterval(lockoutTimer)
    let remaining = rateLimit.remainingSeconds
    lockoutTimer = setInterval(() => {
      remaining--
      if (remaining <= 0) {
        clearInterval(lockoutTimer)
        lockoutTimer = null
        clearRateLimit()
        btn.disabled = false
        btn.textContent = 'Masuk ke Dashboard'
        errDiv.classList.add('hidden')
      } else {
        btn.textContent = `Tunggu ${remaining}s`
        errDiv.textContent = `Terlalu banyak percobaan login gagal. Coba lagi dalam ${remaining} detik.`
      }
    }, 1000)
  }
}

async function handleLogin(e) {
  e.preventDefault()
  const emailInput = document.getElementById('email')
  const passInput = document.getElementById('password')
  const btn = document.getElementById('loginBtn')
  const errDiv = document.getElementById('loginError')

  // Check rate limit first
  const rateLimit = checkRateLimit()
  if (rateLimit.locked) {
    updateRateLimitUI()
    return
  }

  // Client-side email validation
  const email = emailInput.value.trim()
  if (!validateEmail(email)) {
    errDiv.textContent = 'Format email tidak valid.'
    errDiv.classList.remove('hidden')
    return
  }

  // Client-side password validation
  const password = passInput.value
  if (!password || password.length < 8) {
    errDiv.textContent = 'Password minimal 8 karakter.'
    errDiv.classList.remove('hidden')
    return
  }

  errDiv.classList.add('hidden')
  btn.disabled = true
  btn.innerHTML = '<span class="spinner"></span> Memproses...'

  try {
    const session = await login(email, password)
    // Redirect ke dashboard
    window.location.href = 'dashboard.html'
  } catch (err) {
    errDiv.textContent = safeErrorMessage(err)
    errDiv.classList.remove('hidden')
    btn.disabled = false
    btn.textContent = 'Masuk ke Dashboard'
    // Update rate limit UI (may now be locked)
    updateRateLimitUI()
  }
}
