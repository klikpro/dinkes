/**
 * dashboard.js — Shell dashboard admin (dashboard.html)
 * Mengatur navigasi tab dan menampilkan konten tab yang dipilih.
 */

let currentUser = null

document.addEventListener('DOMContentLoaded', async () => {
  initSupabase()

  // Set current year
  document.getElementById('currentYear').textContent = new Date().getFullYear()

  // Require auth
  currentUser = requireAuth()
  if (!currentUser) return

  // Ambil data user lengkap (dengan permissions)
  try {
    const fullUser = await Api.getUser(currentUser.id)
    currentUser = { ...currentUser, permissions: fullUser.permissions || [] }
  } catch (e) {
    console.warn('Could not load full user data:', e.message)
  }

  // Render user info
  document.getElementById('userName').textContent = currentUser.name
  document.getElementById('userEmail').textContent = currentUser.email
  document.getElementById('roleChip').textContent =
    currentUser.role === 'super_admin' ? '👑 Super Admin' : '👤 Operator'

  // WAJIB ganti password default sebelum bisa memakai dashboard
  if (!currentUser.password_changed_at) {
    showForcedPasswordChange()
    return
  }

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', () => {
    if (confirm('Yakin ingin keluar?')) {
      logout()
      window.location.href = 'login.html'
    }
  })

  // Ganti password (voluntari, kapan saja)
  document.getElementById('changePwdBtn').addEventListener('click', () => {
    openChangePasswordModal()
  })

  // Render tab bar
  renderTabBar()

  // Load tab pertama
  const hash = window.location.hash.slice(1) || 'cases'
  selectTab(hash)
})

const TABS = [
  { key: 'cases', label: 'Data Kasus', icon: '📋' },
  { key: 'categories', label: 'Kategori & Subkategori', icon: '🗂️', superAdminOnly: true },
  { key: 'districts', label: 'Kecamatan', icon: '🗺️' },
  { key: 'users', label: 'Manajemen User', icon: '👥', superAdminOnly: true },
  { key: 'excel', label: 'Import / Export Excel', icon: '📊' },
  { key: 'chat', label: 'AI Chat', icon: '🤖' },
  { key: 'settings', label: 'Pengaturan', icon: '⚙️', superAdminOnly: true },
]

function renderTabBar() {
  const isSuperAdmin = currentUser.role === 'super_admin'
  const visibleTabs = TABS.filter((t) => !t.superAdminOnly || isSuperAdmin)
  const bar = document.getElementById('tabBar')
  bar.innerHTML = visibleTabs
    .map(
      (t) => `
    <button class="dash-tab" data-tab="${t.key}">
      <span class="icon">${t.icon}</span>
      <span class="label">${t.label}</span>
    </button>
  `
    )
    .join('')

  bar.querySelectorAll('.dash-tab').forEach((btn) => {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab))
  })
}

function selectTab(key) {
  // Validasi tab
  const tab = TABS.find((t) => t.key === key)
  if (!tab) {
    selectTab('cases')
    return
  }
  if (tab.superAdminOnly && currentUser.role !== 'super_admin') {
    selectTab('cases')
    return
  }

  // Update tab bar active state
  document.querySelectorAll('.dash-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === key)
  })

  // Update hash
  window.location.hash = key

  // Render content
  const content = document.getElementById('tabContent')
  content.innerHTML = `<div class="text-center" style="padding: 60px; color: #94a3b8;">
    <div class="spinner spinner-lg" style="margin: 0 auto 12px;"></div>
    <p>Memuat...</p>
  </div>`

  const fnMap = {
    cases: renderCasesTab,
    categories: renderCategoriesTab,
    districts: renderDistrictsTab,
    users: renderUsersTab,
    excel: renderExcelTab,
    chat: renderChatTab,
    settings: renderSettingsTab,
  }

  if (fnMap[key]) {
    fnMap[key](content, currentUser).catch((e) => {
      content.innerHTML = `<div class="alert alert-error">Error: ${safeErrorMessage(e)}</div>`
    })
  }
}

/**
 * Modal ganti password — dipakai kapan saja lewat tombol "Ganti Password".
 * (Untuk paksaan ganti password default di login pertama, lihat
 * showForcedPasswordChange() di bawah, yang memblokir seluruh dashboard.)
 */
function openChangePasswordModal() {
  const body = `
    <form id="pwdForm">
      <div class="form-group">
        <label class="form-label">Password Saat Ini</label>
        <input type="password" class="form-input" id="pwdOld" required maxlength="128" autocomplete="current-password">
      </div>
      <div class="form-group">
        <label class="form-label">Password Baru (min. 8 karakter)</label>
        <input type="password" class="form-input" id="pwdNew" required minlength="8" maxlength="128" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label class="form-label">Ulangi Password Baru</label>
        <input type="password" class="form-input" id="pwdNew2" required minlength="8" maxlength="128" autocomplete="new-password">
      </div>
      <div id="pwdModalError" class="alert alert-error hidden"></div>
      <div class="modal-footer" style="margin: 16px -20px -20px;">
        <button type="button" class="btn btn-secondary" id="pwdCancel">Batal</button>
        <button type="submit" class="btn btn-primary" id="pwdSubmit">Simpan</button>
      </div>
    </form>
  `
  openModal('Ganti Password', body)

  document.getElementById('pwdCancel').addEventListener('click', closeModal)
  document.getElementById('pwdForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const errDiv = document.getElementById('pwdModalError')
    errDiv.classList.add('hidden')
    const oldPwd = document.getElementById('pwdOld').value
    const newPwd = document.getElementById('pwdNew').value
    const newPwd2 = document.getElementById('pwdNew2').value

    if (newPwd !== newPwd2) {
      errDiv.textContent = 'Konfirmasi password baru tidak cocok.'
      errDiv.classList.remove('hidden')
      return
    }
    if (newPwd.length < 8) {
      errDiv.textContent = 'Password baru minimal 8 karakter.'
      errDiv.classList.remove('hidden')
      return
    }

    const btn = document.getElementById('pwdSubmit')
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Menyimpan...'
    try {
      await Api.changeOwnPassword(oldPwd, newPwd)
      closeModal()
      alert('Password berhasil diubah. Silakan login kembali dengan password baru.')
      logout()
      window.location.href = 'login.html'
    } catch (err) {
      errDiv.textContent = safeErrorMessage(err)
      errDiv.classList.remove('hidden')
      btn.disabled = false
      btn.textContent = 'Simpan'
    }
  })
}

/**
 * Blokir akses dashboard sampai password default diganti.
 * (password_changed_at = NULL berarti masih pakai password default/sementara.)
 */
function showForcedPasswordChange() {
  document.getElementById('tabBar').innerHTML = ''
  const content = document.getElementById('tabContent')
  content.innerHTML = `
    <div class="forced-pwd-wrap" style="max-width:420px;margin:60px auto;padding:24px;border-radius:12px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.08);">
      <h2 style="margin-top:0;">🔒 Ganti Password</h2>
      <p style="color:#64748b;font-size:14px;">Akun Anda masih menggunakan password default/sementara.
      Untuk keamanan, silakan buat password baru sebelum melanjutkan.</p>
      <form id="forcedPwdForm">
        <div class="form-group">
          <label class="form-label">Password Saat Ini</label>
          <input type="password" class="form-input" id="fpOld" required maxlength="128" autocomplete="current-password">
        </div>
        <div class="form-group">
          <label class="form-label">Password Baru (min. 8 karakter)</label>
          <input type="password" class="form-input" id="fpNew" required minlength="8" maxlength="128" autocomplete="new-password">
        </div>
        <div class="form-group">
          <label class="form-label">Ulangi Password Baru</label>
          <input type="password" class="form-input" id="fpNew2" required minlength="8" maxlength="128" autocomplete="new-password">
        </div>
        <div id="forcedPwdError" class="alert alert-error hidden"></div>
        <div class="modal-footer" style="padding:0;margin-top:8px;">
          <button type="button" class="btn btn-secondary" id="forcedPwdLogout">Keluar</button>
          <button type="submit" class="btn btn-primary" id="forcedPwdSubmit">Simpan Password Baru</button>
        </div>
      </form>
    </div>
  `

  document.getElementById('forcedPwdLogout').addEventListener('click', () => {
    logout()
    window.location.href = 'login.html'
  })

  document.getElementById('forcedPwdForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const errDiv = document.getElementById('forcedPwdError')
    errDiv.classList.add('hidden')
    const oldPwd = document.getElementById('fpOld').value
    const newPwd = document.getElementById('fpNew').value
    const newPwd2 = document.getElementById('fpNew2').value

    if (newPwd !== newPwd2) {
      errDiv.textContent = 'Konfirmasi password baru tidak cocok.'
      errDiv.classList.remove('hidden')
      return
    }
    if (newPwd.length < 8) {
      errDiv.textContent = 'Password baru minimal 8 karakter.'
      errDiv.classList.remove('hidden')
      return
    }

    const btn = document.getElementById('forcedPwdSubmit')
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Menyimpan...'
    try {
      await Api.changeOwnPassword(oldPwd, newPwd)
      alert('Password berhasil diubah. Silakan login kembali.')
      logout()
      window.location.href = 'login.html'
    } catch (err) {
      errDiv.textContent = safeErrorMessage(err)
      errDiv.classList.remove('hidden')
      btn.disabled = false
      btn.textContent = 'Simpan Password Baru'
    }
  })
}
