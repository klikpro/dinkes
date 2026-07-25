/**
 * login.js — Logika halaman login (login.html)
 */

document.addEventListener('DOMContentLoaded', () => {
  initSupabase()

  // Jika sudah login, redirect ke dashboard
  if (getCurrentUser()) {
    window.location.href = 'dashboard.html'
    return
  }

  document.getElementById('loginForm').addEventListener('submit', handleLogin)
})

async function handleLogin(e) {
  e.preventDefault()
  const emailInput = document.getElementById('email')
  const passInput = document.getElementById('password')
  const btn = document.getElementById('loginBtn')
  const errDiv = document.getElementById('loginError')

  errDiv.classList.add('hidden')
  btn.disabled = true
  btn.innerHTML = '<span class="spinner"></span> Memproses...'

  try {
    const session = await login(emailInput.value, passInput.value)
    // Redirect ke dashboard
    window.location.href = 'dashboard.html'
  } catch (err) {
    errDiv.textContent = err.message
    errDiv.classList.remove('hidden')
    btn.disabled = false
    btn.textContent = 'Masuk ke Dashboard'
  }
}
