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

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', () => {
    if (confirm('Yakin ingin keluar?')) {
      logout()
      window.location.href = 'login.html'
    }
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
      content.innerHTML = `<div class="alert alert-error">Error: ${e.message}</div>`
    })
  }
}
