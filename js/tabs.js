/**
 * tabs.js — Implementasi semua tab dashboard
 * Dipanggil oleh dashboard.js via selectTab()
 *
 * Setiap fungsi tab: async renderCasesTab(container, user), dll.
 */

// ===========================================================================
// HELPER FUNCTIONS
// ===========================================================================

function fmtDate(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '-'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd} ${mm} ${yy}`
}

function fmtDateTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function sanitizeAttr(str) {
  // Escape for HTML attribute context (quotes)
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Validate a category color is a plain #rgb/#rrggbb hex value before it's
 * interpolated into a style="..." attribute. See public.js for why this
 * matters even for dashboard-only rendering: the same color value also
 * gets rendered on the public map page.
 */
function safeColor(value) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value || '') ? value : '#065f46'
}

function checkPasswordStrength(pwd) {
  if (!pwd || pwd.length < 8) return { score: 0, label: 'Terlalu pendek', color: '#dc2626' }
  let score = 0
  if (pwd.length >= 12) score++
  if (/[A-Z]/.test(pwd)) score++
  if (/[0-9]/.test(pwd)) score++
  if (/[^A-Za-z0-9]/.test(pwd)) score++
  if (score <= 1) return { score, label: 'Lemah', color: '#dc2626' }
  if (score <= 2) return { score, label: 'Cukup', color: '#d97706' }
  return { score, label: 'Kuat', color: '#059669' }
}

function openModal(title, bodyHtml, options = {}) {
  const container = document.getElementById('modalContainer')
  container.innerHTML = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal ${options.size === 'lg' ? 'modal-lg' : ''}" id="modalInner">
        <div class="modal-header">
          <h3>${sanitizeHtml(title)}</h3>
          <button class="modal-close" id="modalCloseBtn">×</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>
  `
  // NOTE: this used to be an inline onclick="event.stopPropagation()" attribute.
  // The CSP on every page (script-src has no 'unsafe-inline') blocks inline
  // event handler attributes, so that click-through-to-overlay guard was
  // silently non-functional — clicking anywhere inside the modal would
  // bubble up and instantly close it. Using addEventListener instead works
  // under the CSP and actually stops the click from reaching the overlay.
  document.getElementById('modalInner').addEventListener('click', (e) => e.stopPropagation())
  document.getElementById('modalOverlay').addEventListener('click', closeModal)
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal)
}
function closeModal() {
  document.getElementById('modalContainer').innerHTML = ''
}

function showLoading(container, msg = 'Memuat...') {
  container.innerHTML = `<div class="text-center" style="padding: 60px; color: #94a3b8;">
    <div class="spinner spinner-lg" style="margin: 0 auto 12px;"></div>
    <p>${msg}</p>
  </div>`
}

// ===========================================================================
// TAB: DATA KASUS
// ===========================================================================

async function renderCasesTab(container, user) {
  showLoading(container)
  const [categories, districts, cases] = await Promise.all([
    Api.getCategories(),
    Api.getDistricts(),
    Api.getCases(),
  ])

  // Filter cases untuk non-super-admin (hanya yang ada di permission)
  const allowedSubIds = new Set(
    user.role === 'super_admin'
      ? categories.flatMap((c) => c.subcategories.map((s) => s.id))
      : (user.permissions || []).map((p) => p.subcategory_id)
  )

  const allowedSubcats = categories
    .filter((c) => c.is_active)
    .flatMap((c) => c.subcategories.filter((s) => s.is_active && allowedSubIds.has(s.id)))

  let filtered = cases
  let filterDistrict = ''
  let filterCategory = ''

  function renderTable() {
    const filteredCases = filtered.filter((c) => {
      if (filterDistrict && c.district_id !== filterDistrict) return false
      if (filterCategory && c.subcategory.category_id !== filterCategory) return false
      return true
    })

    container.innerHTML = `
      <div class="tab-header">
        <div>
          <h2>📋 Data Kasus Kesehatan</h2>
          <p>Kelola data kasus per kecamatan, kategori, dan subkategori.</p>
        </div>
        <button class="btn btn-primary" id="addCaseBtn" ${allowedSubcats.length === 0 ? 'disabled' : ''}>
          + Tambah Data
        </button>
      </div>

      ${allowedSubcats.length === 0 ? `
        <div class="alert alert-warning">
          ⚠️ Anda belum memiliki izin untuk menginput data subkategori apa pun.
          Hubungi Super Admin untuk mengatur hak akses.
        </div>
      ` : ''}

      <div class="filters-bar">
        <div class="filter-group">
          <label>Filter Kecamatan</label>
          <select id="filterDistrict">
            <option value="" ${filterDistrict === '' ? 'selected' : ''}>Semua</option>
            ${districts.map((d) => `<option value="${d.id}" ${filterDistrict === d.id ? 'selected' : ''}>${sanitizeHtml(d.name)}</option>`).join('')}
          </select>
        </div>
        <div class="filter-group">
          <label>Filter Kategori</label>
          <select id="filterCategory">
            <option value="" ${filterCategory === '' ? 'selected' : ''}>Semua</option>
            ${categories.map((c) => `<option value="${c.id}" ${filterCategory === c.id ? 'selected' : ''}>${sanitizeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        ${(filterDistrict || filterCategory) ? `<button class="btn btn-secondary" id="resetFilterBtn" type="button">✕ Reset Filter</button>` : ''}
        <div class="total-info">Total <b style="color:#0f1e1a">${filteredCases.length}</b> data</div>
      </div>

      <div class="data-table-wrap">
        <div class="data-table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Kecamatan</th>
                <th>Kategori</th>
                <th>Subkategori</th>
                <th class="text-right">Nilai</th>
                <th>Periode</th>
                <th>Update Terakhir</th>
                <th class="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${filteredCases.length === 0 ? `
                <tr class="empty-row"><td colspan="7">Tidak ada data. Klik "Tambah Data" untuk membuat baru.</td></tr>
              ` : filteredCases.map((c) => `
                <tr>
                  <td class="font-semibold">${sanitizeHtml(c.district.name)}</td>
                  <td>
                    <span class="badge" style="background: ${safeColor(c.subcategory.category.color)}20; color: ${safeColor(c.subcategory.category.color)}">
                      ${sanitizeHtml(c.subcategory.category.name)}
                    </span>
                  </td>
                  <td>
                    ${sanitizeHtml(c.subcategory.name)}
                    ${c.subcategory.unit ? `<span class="text-tiny text-muted">(${sanitizeHtml(c.subcategory.unit)})</span>` : ''}
                  </td>
                  <td class="text-right font-bold" style="font-size: 14px;">${sanitizeHtml(c.value)}</td>
                  <td class="text-muted text-small">${sanitizeHtml(c.period || '-')}</td>
                  <td class="text-muted text-small">${fmtDateTime(c.updated_at)}</td>
                  <td>
                    <div class="actions">
                      <button class="action-btn edit" data-edit="${c.id}">Edit</button>
                      <button class="action-btn delete" data-del="${c.id}">Hapus</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `

    // Bind events
    document.getElementById('addCaseBtn').addEventListener('click', () => showCaseForm(user, categories, districts, allowedSubIds, null))
    document.getElementById('filterDistrict').addEventListener('change', (e) => {
      filterDistrict = e.target.value
      renderTable()
    })
    document.getElementById('filterCategory').addEventListener('change', (e) => {
      filterCategory = e.target.value
      renderTable()
    })
    const resetBtn = document.getElementById('resetFilterBtn')
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        filterDistrict = ''
        filterCategory = ''
        renderTable()
      })
    }
    document.querySelectorAll('[data-edit]').forEach((b) => {
      b.addEventListener('click', () => {
        const c = cases.find((x) => x.id === b.dataset.edit)
        showCaseForm(user, categories, districts, allowedSubIds, c)
      })
    })
    document.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Hapus data ini?')) return
        try {
          await Api.deleteCase(b.dataset.del)
          renderCasesTab(container, user)
        } catch (e) { alert(safeErrorMessage(e)) }
      })
    })
  }

  renderTable()
}

function showCaseForm(user, categories, districts, allowedSubIds, editing) {
  const isEdit = !!editing
  const periodDefault = new Date().toISOString().slice(0, 7)
  const body = `
    <form id="caseForm">
      <div class="form-group">
        <label class="form-label">Kecamatan</label>
        <select class="form-select" id="cfDistrict" required ${isEdit ? 'disabled' : ''}>
          <option value="">Pilih kecamatan</option>
          ${districts.map((d) => `<option value="${d.id}" ${isEdit && editing.district_id === d.id ? 'selected' : ''}>${sanitizeHtml(d.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Subkategori</label>
        <select class="form-select" id="cfSubcat" required ${isEdit ? 'disabled' : ''}>
          <option value="">Pilih subkategori</option>
          ${categories.map((c) => `
            <optgroup label="${sanitizeHtml(c.name)}">
              ${c.subcategories
                .filter((s) => allowedSubIds.has(s.id) && s.is_active)
                .map((s) => `<option value="${s.id}" ${isEdit && editing.subcategory_id === s.id ? 'selected' : ''}>${sanitizeHtml(s.name)} ${s.unit ? `(${sanitizeHtml(s.unit)})` : ''}</option>`)
                .join('')}
            </optgroup>
          `).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Nilai</label>
        <input type="number" step="0.01" class="form-input" id="cfValue" required min="0" max="999999" value="${isEdit ? sanitizeAttr(editing.value) : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Periode (YYYY-MM)</label>
        <input type="month" class="form-input" id="cfPeriod" value="${isEdit ? sanitizeAttr(editing.period || periodDefault) : periodDefault}">
      </div>
      <div class="form-group">
        <label class="form-label">Catatan (opsional)</label>
        <textarea class="form-textarea" id="cfNotes" rows="2" maxlength="500">${isEdit ? sanitizeHtml(editing.notes || '') : ''}</textarea>
      </div>
      <div class="modal-footer" style="margin: 16px -20px -20px;">
        <button type="button" class="btn btn-secondary" id="cfCancel">Batal</button>
        <button type="submit" class="btn btn-primary" id="cfSubmit">${isEdit ? 'Update' : 'Simpan'}</button>
      </div>
    </form>
  `
  openModal(isEdit ? 'Edit Data Kasus' : 'Tambah Data Kasus', body)

  document.getElementById('cfCancel').addEventListener('click', closeModal)
  document.getElementById('caseForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = document.getElementById('cfSubmit')
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Menyimpan...'
    try {
      const payload = {
        district_id: document.getElementById('cfDistrict').value,
        subcategory_id: document.getElementById('cfSubcat').value,
        value: parseFloat(document.getElementById('cfValue').value),
        period: document.getElementById('cfPeriod').value || null,
        notes: document.getElementById('cfNotes').value.trim() || null,
      }
      // Validate value range
      if (isNaN(payload.value) || payload.value < 0 || payload.value > 999999) {
        throw new Error('Nilai harus berupa angka antara 0 dan 999999.')
      }
      if (isEdit) {
        await Api.updateCase(editing.id, { value: payload.value, period: payload.period, notes: payload.notes }, user.id)
      } else {
        await Api.upsertCase(payload, user.id)
      }
      closeModal()
      // Reload tab
      const content = document.getElementById('tabContent')
      renderCasesTab(content, user)
    } catch (err) {
      alert(safeErrorMessage(err))
      btn.disabled = false
      btn.textContent = isEdit ? 'Update' : 'Simpan'
    }
  })
}

// ===========================================================================
// TAB: KATEGORI & SUBKATEGORI
// ===========================================================================

async function renderCategoriesTab(container, user) {
  showLoading(container)
  const categories = await Api.getCategories()

  container.innerHTML = `
    <div class="tab-header">
      <div>
        <h2>🗂️ Kategori & Subkategori</h2>
        <p>Kelola kategori penyakit/indikator. Aktifkan/nonaktifkan untuk menampilkan di frontend.</p>
      </div>
      <button class="btn btn-primary" id="addCatBtn">+ Tambah Kategori</button>
    </div>

    <div id="catList">
      ${categories.length === 0 ? `
        <div class="alert alert-warning">Belum ada kategori. Klik "Tambah Kategori" untuk membuat.</div>
      ` : categories.map((cat) => `
        <div class="cat-card ${cat.is_active ? '' : 'inactive'}">
          <div class="cat-head">
            <div class="info">
              <div class="color-dot" style="background: ${safeColor(cat.color)}"></div>
              <div>
                <h3>
                  ${sanitizeHtml(cat.name)}
                  ${!cat.is_active ? '<span class="badge badge-muted">NONAKTIF</span>' : ''}
                </h3>
                ${cat.description ? `<div class="desc">${sanitizeHtml(cat.description)}</div>` : ''}
              </div>
            </div>
            <div class="actions">
              <button class="btn btn-sm btn-secondary" data-edit-cat="${cat.id}">Edit</button>
              <button class="btn btn-sm ${cat.is_active ? 'btn-secondary' : 'btn-primary'}" data-toggle-cat="${cat.id}">
                ${cat.is_active ? 'Nonaktifkan' : 'Aktifkan'}
              </button>
              <button class="btn btn-sm btn-danger" data-del-cat="${cat.id}">Hapus</button>
            </div>
          </div>
          <div class="subcat-list">
            <div class="subcat-list-head">
              <span class="title">SUBKATEGORI (${cat.subcategories.length})</span>
              <button class="add-btn" data-add-sub="${cat.id}">+ Tambah Subkategori</button>
            </div>
            ${cat.subcategories.length === 0 ? `
              <div style="padding: 12px 16px; font-size: 12px; color: #94a3b8; font-style: italic;">Belum ada subkategori.</div>
            ` : cat.subcategories.map((sub) => `
              <div class="subcat-item">
                <div>
                  <div class="name">
                    ${sanitizeHtml(sub.name)}
                    ${sub.unit ? `<span class="unit">(${sanitizeHtml(sub.unit)})</span>` : ''}
                    ${!sub.is_active ? '<span class="badge badge-muted">NONAKTIF</span>' : ''}
                  </div>
                  ${sub.description ? `<div class="desc">${sanitizeHtml(sub.description)}</div>` : ''}
                </div>
                <div class="actions">
                  <button class="btn btn-sm btn-secondary" data-edit-sub="${sub.id}">Edit</button>
                  <button class="btn btn-sm ${sub.is_active ? 'btn-secondary' : 'btn-primary'}" data-toggle-sub="${sub.id}">
                    ${sub.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                  <button class="btn btn-sm btn-danger" data-del-sub="${sub.id}">Hapus</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `

  // Bind events
  document.getElementById('addCatBtn').addEventListener('click', () => showCategoryForm(user, null))
  document.querySelectorAll('[data-edit-cat]').forEach((b) => {
    b.addEventListener('click', () => {
      const c = categories.find((x) => x.id === b.dataset.editCat)
      showCategoryForm(user, c)
    })
  })
  document.querySelectorAll('[data-toggle-cat]').forEach((b) => {
    b.addEventListener('click', async () => {
      const c = categories.find((x) => x.id === b.dataset.toggleCat)
      try {
        await Api.updateCategory(c.id, { is_active: !c.is_active })
        renderCategoriesTab(container, user)
      } catch (e) { alert(safeErrorMessage(e)) }
    })
  })
  document.querySelectorAll('[data-del-cat]').forEach((b) => {
    b.addEventListener('click', async () => {
      const c = categories.find((x) => x.id === b.dataset.delCat)
      if (!confirm(`Hapus kategori "${c.name}" beserta semua subkategori & datanya?`)) return
      try {
        await Api.deleteCategory(b.dataset.delCat)
        renderCategoriesTab(container, user)
      } catch (e) { alert(safeErrorMessage(e)) }
    })
  })
  document.querySelectorAll('[data-add-sub]').forEach((b) => {
    b.addEventListener('click', () => {
      const c = categories.find((x) => x.id === b.dataset.addSub)
      showSubcategoryForm(user, c, null)
    })
  })
  document.querySelectorAll('[data-edit-sub]').forEach((b) => {
    b.addEventListener('click', () => {
      let found = null
      let parentCat = null
      for (const c of categories) {
        const s = c.subcategories.find((x) => x.id === b.dataset.editSub)
        if (s) { found = s; parentCat = c; break }
      }
      showSubcategoryForm(user, parentCat, found)
    })
  })
  document.querySelectorAll('[data-toggle-sub]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await Api.updateSubcategory(b.dataset.toggleSub, {})
        // Toggle by fetching current state first
        const cats = await Api.getCategories()
        let sub = null
        cats.forEach((c) => c.subcategories.forEach((s) => { if (s.id === b.dataset.toggleSub) sub = s }))
        if (sub) {
          await Api.updateSubcategory(b.dataset.toggleSub, { is_active: !sub.is_active })
        }
        renderCategoriesTab(container, user)
      } catch (e) { alert(safeErrorMessage(e)) }
    })
  })
  document.querySelectorAll('[data-del-sub]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Hapus subkategori ini beserta semua datanya?')) return
      try {
        await Api.deleteSubcategory(b.dataset.delSub)
        renderCategoriesTab(container, user)
      } catch (e) { alert(safeErrorMessage(e)) }
    })
  })
}

function showCategoryForm(user, editing) {
  const isEdit = !!editing
  const body = `
    <form id="catForm">
      <div class="form-group">
        <label class="form-label">Nama Kategori</label>
        <input class="form-input" id="catName" required maxlength="50" value="${isEdit ? sanitizeAttr(editing.name) : ''}" placeholder="e.g. Penyakit Menular">
      </div>
      <div class="form-group">
        <label class="form-label">Deskripsi</label>
        <textarea class="form-textarea" id="catDesc" rows="2" maxlength="500">${isEdit ? sanitizeHtml(editing.description || '') : ''}</textarea>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">Ikon (emoji)</label>
          <input class="form-input" id="catIcon" value="${isEdit ? (editing.icon || '') : ''}" placeholder="🦠">
        </div>
        <div class="form-group">
          <label class="form-label">Warna</label>
          <input type="color" class="form-input" id="catColor" value="${isEdit ? (editing.color || '#065f46') : '#065f46'}" style="height: 38px; padding: 2px;">
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">Urutan</label>
          <input type="number" class="form-input" id="catSort" value="${isEdit ? editing.sort_order : 0}">
        </div>
        <div class="form-group">
          <label class="form-label">&nbsp;</label>
          <label style="display: flex; align-items: center; gap: 6px; padding: 8px 0;">
            <input type="checkbox" id="catActive" ${isEdit ? (editing.is_active ? 'checked' : '') : 'checked'}>
            <span>Aktif</span>
          </label>
        </div>
      </div>
      <div class="modal-footer" style="margin: 16px -20px -20px;">
        <button type="button" class="btn btn-secondary" id="catCancel">Batal</button>
        <button type="submit" class="btn btn-primary" id="catSubmit">${isEdit ? 'Update' : 'Simpan'}</button>
      </div>
    </form>
  `
  openModal(isEdit ? 'Edit Kategori' : 'Tambah Kategori', body)
  document.getElementById('catCancel').addEventListener('click', closeModal)
  document.getElementById('catForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = document.getElementById('catSubmit')
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Menyimpan...'
    try {
      const payload = {
        name: document.getElementById('catName').value.trim(),
        description: document.getElementById('catDesc').value.trim() || null,
        icon: document.getElementById('catIcon').value.trim() || null,
        color: document.getElementById('catColor').value,
        sort_order: parseInt(document.getElementById('catSort').value) || 0,
        is_active: document.getElementById('catActive').checked,
      }
      if (isEdit) {
        await Api.updateCategory(editing.id, payload)
      } else {
        await Api.createCategory(payload)
      }
      closeModal()
      const content = document.getElementById('tabContent')
      renderCategoriesTab(content, user)
    } catch (err) {
      alert(safeErrorMessage(err))
      btn.disabled = false
      btn.textContent = isEdit ? 'Update' : 'Simpan'
    }
  })
}

function showSubcategoryForm(user, cat, editing) {
  const isEdit = !!editing
  const body = `
    <form id="subForm">
      <div style="background: #f1f5f9; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; font-size: 12px;">
        Kategori: <b>${sanitizeHtml(cat.name)}</b>
      </div>
      <div class="form-group">
        <label class="form-label">Nama Subkategori</label>
        <input class="form-input" id="subName" required maxlength="50" value="${isEdit ? sanitizeAttr(editing.name) : ''}" placeholder="e.g. TB, Stunting, Ibu Hamil">
      </div>
      <div class="form-group">
        <label class="form-label">Deskripsi</label>
        <textarea class="form-textarea" id="subDesc" rows="2" maxlength="500">${isEdit ? sanitizeHtml(editing.description || '') : ''}</textarea>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">Satuan</label>
          <input class="form-input" id="subUnit" maxlength="20" value="${isEdit ? sanitizeAttr(editing.unit || '') : ''}" placeholder="orang / anak / %">
        </div>
        <div class="form-group">
          <label class="form-label">Urutan</label>
          <input type="number" class="form-input" id="subSort" value="${isEdit ? editing.sort_order : 0}">
        </div>
      </div>
      <label style="display: flex; align-items: center; gap: 6px; padding: 8px 0;">
        <input type="checkbox" id="subActive" ${isEdit ? (editing.is_active ? 'checked' : '') : 'checked'}>
        <span>Aktif (tampil di frontend)</span>
      </label>
      <div class="modal-footer" style="margin: 16px -20px -20px;">
        <button type="button" class="btn btn-secondary" id="subCancel">Batal</button>
        <button type="submit" class="btn btn-primary" id="subSubmit">${isEdit ? 'Update' : 'Simpan'}</button>
      </div>
    </form>
  `
  openModal(isEdit ? 'Edit Subkategori' : `Tambah Subkategori · ${sanitizeHtml(cat.name)}`, body)
  document.getElementById('subCancel').addEventListener('click', closeModal)
  document.getElementById('subForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = document.getElementById('subSubmit')
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Menyimpan...'
    try {
      const payload = {
        name: document.getElementById('subName').value.trim(),
        description: document.getElementById('subDesc').value.trim() || null,
        unit: document.getElementById('subUnit').value.trim() || null,
        sort_order: parseInt(document.getElementById('subSort').value) || 0,
        is_active: document.getElementById('subActive').checked,
      }
      if (isEdit) {
        await Api.updateSubcategory(editing.id, payload)
      } else {
        await Api.createSubcategory(cat.id, payload)
      }
      closeModal()
      const content = document.getElementById('tabContent')
      renderCategoriesTab(content, user)
    } catch (err) {
      alert(safeErrorMessage(err))
      btn.disabled = false
      btn.textContent = isEdit ? 'Update' : 'Simpan'
    }
  })
}

// ===========================================================================
// TAB: KECAMATAN
// ===========================================================================

async function renderDistrictsTab(container, user) {
  showLoading(container)
  const districts = await Api.getDistricts()

  container.innerHTML = `
    <div class="tab-header">
      <div>
        <h2>🗺️ Kecamatan</h2>
        <p>Kelola daftar kecamatan beserta koordinat untuk penanda peta.</p>
      </div>
      <button class="btn btn-primary" id="addDistBtn">+ Tambah Kecamatan</button>
    </div>

    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Nama Kecamatan</th>
            <th>Latitude</th>
            <th>Longitude</th>
            <th class="text-right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          ${districts.length === 0 ? `
            <tr class="empty-row"><td colspan="4">Belum ada kecamatan.</td></tr>
          ` : districts.map((d) => `
            <tr>
              <td class="font-semibold">${sanitizeHtml(d.name)}</td>
              <td class="text-muted">${d.latitude}</td>
              <td class="text-muted">${d.longitude}</td>
              <td>
                <div class="actions">
                  <button class="action-btn edit" data-edit="${d.id}">Edit</button>
                  <button class="action-btn delete" data-del="${d.id}">Hapus</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `

  document.getElementById('addDistBtn').addEventListener('click', () => showDistrictForm(user, null))
  document.querySelectorAll('[data-edit]').forEach((b) => {
    b.addEventListener('click', () => {
      const d = districts.find((x) => x.id === b.dataset.edit)
      showDistrictForm(user, d)
    })
  })
  document.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      const d = districts.find((x) => x.id === b.dataset.del)
      if (!confirm(`Hapus kecamatan "${sanitizeHtml(d.name)}"? Semua data kasus terkait akan ikut terhapus.`)) return
      try {
        await Api.deleteDistrict(b.dataset.del)
        renderDistrictsTab(container, user)
      } catch (e) { alert(safeErrorMessage(e)) }
    })
  })
}

function showDistrictForm(user, editing) {
  const isEdit = !!editing
  const body = `
    <form id="distForm">
      <div class="form-group">
        <label class="form-label">Nama Kecamatan</label>
        <input class="form-input" id="distName" required maxlength="50" value="${isEdit ? sanitizeAttr(editing.name) : ''}">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">Latitude</label>
          <input type="number" step="0.0001" class="form-input" id="distLat" required value="${isEdit ? editing.latitude : ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Longitude</label>
          <input type="number" step="0.0001" class="form-input" id="distLng" required value="${isEdit ? editing.longitude : ''}">
        </div>
      </div>
      <div class="modal-footer" style="margin: 16px -20px -20px;">
        <button type="button" class="btn btn-secondary" id="distCancel">Batal</button>
        <button type="submit" class="btn btn-primary" id="distSubmit">${isEdit ? 'Update' : 'Simpan'}</button>
      </div>
    </form>
  `
  openModal(isEdit ? 'Edit Kecamatan' : 'Tambah Kecamatan', body)
  document.getElementById('distCancel').addEventListener('click', closeModal)
  document.getElementById('distForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = document.getElementById('distSubmit')
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Menyimpan...'
    try {
      const payload = {
        name: document.getElementById('distName').value.trim(),
        latitude: parseFloat(document.getElementById('distLat').value),
        longitude: parseFloat(document.getElementById('distLng').value),
      }
      if (isEdit) {
        await Api.updateDistrict(editing.id, payload)
      } else {
        await Api.createDistrict(payload)
      }
      closeModal()
      const content = document.getElementById('tabContent')
      renderDistrictsTab(content, user)
    } catch (err) {
      alert(safeErrorMessage(err))
      btn.disabled = false
      btn.textContent = isEdit ? 'Update' : 'Simpan'
    }
  })
}

// ===========================================================================
// TAB: MANAJEMEN USER
// ===========================================================================

async function renderUsersTab(container, user) {
  showLoading(container)
  const [users, categories] = await Promise.all([
    Api.getUsers(),
    Api.getCategories(),
  ])

  container.innerHTML = `
    <div class="tab-header">
      <div>
        <h2>👥 Manajemen User</h2>
        <p>Buat akun operator dan atur hak akses per subkategori dengan centang.</p>
      </div>
      <button class="btn btn-primary" id="addUserBtn">+ Tambah User</button>
    </div>

    <div class="user-grid">
      ${users.map((u) => `
        <div class="user-card">
          <div class="head">
            <div>
              <h3>
                ${sanitizeHtml(u.name)}
                ${u.role === 'super_admin' ? '<span class="badge badge-success">SUPER ADMIN</span>' : '<span class="badge badge-muted">OPERATOR</span>'}
                ${!u.is_active ? '<span class="badge badge-danger">NONAKTIF</span>' : ''}
              </h3>
              <div class="email">${sanitizeHtml(u.email)}</div>
              <div class="created">Dibuat: ${fmtDateTime(u.created_at)}</div>
            </div>
            <div class="actions">
              <button class="btn btn-sm btn-secondary" data-edit-user="${u.id}">Edit</button>
              ${u.role !== 'super_admin' ? `<button class="btn btn-sm btn-danger" data-del-user="${u.id}">Hapus</button>` : ''}
            </div>
          </div>
          ${u.role === 'user' ? `
            <div class="perms">
              <div class="perms-title">Hak Akses (${(u.permissions || []).length} subkategori)</div>
              ${(u.permissions || []).length === 0 ? `
                <div class="perm-empty">Belum ada akses. User tidak dapat menginput data apapun.</div>
              ` : `
                <div class="perm-tags">
                  ${u.permissions.map((p) => `
                    <span class="perm-tag" title="${sanitizeHtml(p.subcategory.category.name)}">${sanitizeHtml(p.subcategory.category.name)} · ${sanitizeHtml(p.subcategory.name)}</span>
                  `).join('')}
                </div>
              `}
            </div>
          ` : `
            <div class="perms">
              <div class="perms-title">Hak Akses</div>
              <div style="font-size: 12px; color: #065f46;">
                ✓ Akses penuh ke semua subkategori (Super Admin)
              </div>
            </div>
          `}
        </div>
      `).join('')}
    </div>
  `

  document.getElementById('addUserBtn').addEventListener('click', () => showUserForm(user, categories, null))
  document.querySelectorAll('[data-edit-user]').forEach((b) => {
    b.addEventListener('click', () => {
      const u = users.find((x) => x.id === b.dataset.editUser)
      showUserForm(user, categories, u)
    })
  })
  document.querySelectorAll('[data-del-user]').forEach((b) => {
    b.addEventListener('click', async () => {
      const u = users.find((x) => x.id === b.dataset.delUser)
      if (!confirm(`Hapus user "${sanitizeHtml(u.name)}"?`)) return
      try {
        await Api.deleteUser(b.dataset.delUser)
        renderUsersTab(container, user)
      } catch (e) { alert(safeErrorMessage(e)) }
    })
  })
}

function showUserForm(currentUser, categories, editing) {
  const isEdit = !!editing
  const initialPerms = isEdit ? new Set((editing.permissions || []).map((p) => p.subcategory_id)) : new Set()

  const permCheckboxesHtml = categories.map((cat) => `
    <div class="perm-cat">
      <div class="perm-cat-head">
        <span class="dot" style="background: ${safeColor(cat.color)}"></span>
        <span class="name">${sanitizeHtml(cat.name)} ${!cat.is_active ? '(nonaktif)' : ''}</span>
      </div>
      <div class="perm-cat-items">
        ${cat.subcategories.length === 0 ? '<div style="font-size: 11px; color: #94a3b8; font-style: italic;">Belum ada subkategori.</div>' : cat.subcategories.map((sub) => `
          <label class="perm-item ${!sub.is_active ? 'style="opacity: 0.5;"' : ''}">
            <input type="checkbox" data-perm-sub="${sub.id}" ${initialPerms.has(sub.id) ? 'checked' : ''}>
            <span>${sanitizeHtml(sub.name)}</span>
            ${sub.unit ? `<span class="unit">(${sanitizeHtml(sub.unit)})</span>` : ''}
            ${!sub.is_active ? '<span class="unit">(nonaktif)</span>' : ''}
          </label>
        `).join('')}
      </div>
    </div>
  `).join('')

  const body = `
    <form id="userForm">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">Nama Lengkap</label>
          <input class="form-input" id="userFormName" required maxlength="50" value="${isEdit ? sanitizeAttr(editing.name) : ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" class="form-input" id="userFormEmail" required maxlength="100" value="${isEdit ? sanitizeAttr(editing.email) : ''}">
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label class="form-label">Password ${isEdit ? '(kosongkan jika tidak diubah)' : ''}</label>
          <input type="password" class="form-input" id="userPass" ${isEdit ? '' : 'required'} minlength="8" maxlength="128">
          <div id="pwdStrengthIndicator" style="font-size: 11px; margin-top: 4px; min-height: 14px;"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <select class="form-select" id="userRole">
            <option value="user" ${isEdit && editing.role === 'user' ? 'selected' : ''}>Operator (terbatas)</option>
            <option value="super_admin" ${isEdit && editing.role === 'super_admin' ? 'selected' : ''}>Super Admin (akses penuh)</option>
          </select>
        </div>
      </div>
      <label style="display: flex; align-items: center; gap: 6px; padding: 8px 0;">
        <input type="checkbox" id="userActive" ${isEdit ? (editing.is_active ? 'checked' : '') : 'checked'}>
        <span>Akun aktif</span>
      </label>

      <div id="permSection" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
        <div style="font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 4px;">Hak Akses Subkategori</div>
        <div style="font-size: 11px; color: #94a3b8; margin-bottom: 12px;">
          Centang subkategori yang boleh diinput/diedit oleh user ini.
        </div>
        <div class="perm-group">${permCheckboxesHtml}</div>
        <div style="font-size: 11px; color: #64748b; margin-top: 8px;">
          Terpilih: <b id="permCount">0</b> subkategori
        </div>
      </div>

      <div id="superAdminInfo" class="alert alert-info" style="margin-top: 16px; display: none;">
        ℹ️ Super Admin memiliki akses penuh ke semua subkategori secara otomatis.
      </div>

      <div class="modal-footer" style="margin: 16px -20px -20px;">
        <button type="button" class="btn btn-secondary" id="userCancel">Batal</button>
        <button type="submit" class="btn btn-primary" id="userSubmit">${isEdit ? 'Update' : 'Simpan'}</button>
      </div>
    </form>
  `
  openModal(isEdit ? `Edit User · ${sanitizeHtml(editing.name)}` : 'Tambah User Baru', body, { size: 'lg' })

  // Update perm count + super admin info
  function updatePermUI() {
    const role = document.getElementById('userRole').value
    const isSuper = role === 'super_admin'
    document.getElementById('permSection').style.display = isSuper ? 'none' : 'block'
    document.getElementById('superAdminInfo').style.display = isSuper ? 'block' : 'none'
    const count = document.querySelectorAll('[data-perm-sub]:checked').length
    document.getElementById('permCount').textContent = count
  }

  // Password strength indicator
  const passInput = document.getElementById('userPass')
  const strengthDiv = document.getElementById('pwdStrengthIndicator')
  passInput.addEventListener('input', () => {
    const pwd = passInput.value
    if (!pwd) { strengthDiv.innerHTML = ''; return }
    const strength = checkPasswordStrength(pwd)
    strengthDiv.innerHTML = `<span style="color: ${strength.color}">${strength.label}</span> (${pwd.length} karakter)`
  })

  document.getElementById('userRole').addEventListener('change', updatePermUI)
  document.querySelectorAll('[data-perm-sub]').forEach((cb) => {
    cb.addEventListener('change', updatePermUI)
  })
  updatePermUI()

  document.getElementById('userCancel').addEventListener('click', closeModal)
  document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = document.getElementById('userSubmit')
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Menyimpan...'
    try {
      const role = document.getElementById('userRole').value
      const perms = Array.from(document.querySelectorAll('[data-perm-sub]:checked')).map((cb) => ({
        subcategory_id: cb.dataset.permSub,
        can_input: true,
      }))
      const payload = {
        name: document.getElementById('userFormName').value.trim(),
        email: document.getElementById('userFormEmail').value.trim(),
        role,
        is_active: document.getElementById('userActive').checked,
        permissions: role === 'super_admin' ? [] : perms,
      }
      const passVal = document.getElementById('userPass').value
      if (passVal) {
        if (passVal.length < 8) throw new Error('Password minimal 8 karakter.')
        payload.password = passVal
      }

      // Validate email format
      if (!validateEmail(payload.email)) throw new Error('Format email tidak valid.')

      if (isEdit) {
        await Api.updateUser(editing.id, payload)
      } else {
        await Api.createUser(payload)
      }
      closeModal()
      const content = document.getElementById('tabContent')
      renderUsersTab(content, currentUser)
    } catch (err) {
      alert(safeErrorMessage(err))
      btn.disabled = false
      btn.textContent = isEdit ? 'Update' : 'Simpan'
    }
  })
}

// ===========================================================================
// TAB: EXCEL IMPORT/EXPORT
// ===========================================================================

async function renderExcelTab(container, user) {
  container.innerHTML = `
    <div class="tab-header">
      <div>
        <h2>📊 Import / Export Excel</h2>
        <p>Ekspor data ke file Excel (.xlsx) atau impor data dari file Excel. Heading Excel dapat diatur di menu Pengaturan.</p>
      </div>
    </div>

    <div class="excel-grid">
      <div class="excel-card">
        <h3>⬇️ Export ke Excel</h3>
        <p>Unduh seluruh data kasus kesehatan (yang Anda memiliki akses) dalam format Excel. File akan otomatis memiliki heading sesuai pengaturan.</p>
        <button class="btn btn-primary w-full" id="exportBtn">📥 Download Excel</button>
        <div class="text-tiny text-muted mt-3">
          Format file: .xlsx · Berisi: Kecamatan, Kategori, Subkategori, Nilai, Periode, Update
        </div>
      </div>

      <div class="excel-card">
        <h3>⬆️ Import dari Excel</h3>
        <p>Unggah file Excel untuk menambah/memperbarui data kasus secara massal. Kolom yang diperlukan: <b>Kecamatan</b>, <b>Subkategori</b>, <b>Nilai</b>. Opsional: <b>Periode</b>, <b>Catatan</b>.</p>
        <input type="file" class="file-input" id="importFile" accept=".xlsx,.xls,.csv">
        <div id="importResult" class="mt-3"></div>
        <div class="template-download-box mt-3">
          <div>
            <b>📄 Belum tahu formatnya?</b>
            <p class="text-tiny text-muted" style="margin: 2px 0 0;">
              Unduh contoh file Excel — otomatis dibuat dari daftar Kecamatan &
              Kategori/Subkategori yang sedang ada di database, jadi selalu sesuai/sinkron.
            </p>
          </div>
          <button class="btn btn-secondary" id="downloadTemplateBtn" type="button">⬇️ Download Contoh</button>
        </div>
      </div>
    </div>

    <div class="excel-template-info mt-4">
      <p class="font-bold mb-2">📋 Format File Excel untuk Import:</p>
      <p>Baris 1-3: Heading (boleh ada/tidak, akan dilewati otomatis).</p>
      <p>Baris header wajib berisi minimal: <b>Kecamatan</b>, <b>Subkategori</b>, <b>Nilai</b>.</p>
      <p class="mt-2">Nilai Kecamatan & Subkategori harus <b>sama persis</b> dengan yang ada di database (case-insensitive).</p>
      <p class="mt-2">Tip: Lakukan Export terlebih dahulu untuk melihat format yang benar, lalu edit nilainya.</p>
    </div>
  `

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const btn = document.getElementById('exportBtn')
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Menyiapkan...'
    try {
      await ExcelIO.export(user)
    } catch (e) {
      alert('Gagal export: ' + safeErrorMessage(e))
    } finally {
      btn.disabled = false
      btn.innerHTML = '📥 Download Excel'
    }
  })

  document.getElementById('downloadTemplateBtn').addEventListener('click', async () => {
    const btn = document.getElementById('downloadTemplateBtn')
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Menyiapkan...'
    try {
      await ExcelIO.downloadTemplate()
    } catch (e) {
      alert('Gagal membuat contoh: ' + safeErrorMessage(e))
    } finally {
      btn.disabled = false
      btn.innerHTML = '⬇️ Download Contoh'
    }
  })

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const resultDiv = document.getElementById('importResult')
    resultDiv.innerHTML = '<div class="alert alert-info"><span class="spinner"></span> Mengimpor...</div>'
    try {
      const result = await ExcelIO.import(file, user)
      let html = `<div class="alert alert-success">✅ Berhasil mengimpor <b>${result.imported}</b> baris data.</div>`
      if (result.errors.length > 0) {
        html += `
          <div class="alert alert-warning mt-2">
            <b>⚠️ ${result.errors.length} baris dilewati:</b>
            <ul style="margin: 6px 0 0 16px; max-height: 120px; overflow-y: auto;">
              ${result.errors.map((er) => `<li>Baris ${er.row}: ${sanitizeHtml(er.message)}</li>`).join('')}
            </ul>
          </div>
        `
      }
      resultDiv.innerHTML = html
    } catch (e) {
      resultDiv.innerHTML = `<div class="alert alert-error">❌ ${safeErrorMessage(e)}</div>`
    }
    e.target.value = ''
  })
}

// ===========================================================================
// TAB: AI CHAT (dashboard)
// ===========================================================================

async function renderChatTab(container, user) {
  container.innerHTML = `
    <div class="tab-header">
      <div>
        <h2>🤖 AI Chat · Asisten Dinkes</h2>
        <p>Tanyakan apa saja seputar data kesehatan di Kabupaten Indragiri Hulu. AI menjawab berdasarkan data di database.</p>
      </div>
    </div>

    <div class="chat-container">
      <div class="chat-messages" id="dashChatMessages">
        <div class="chat-msg assistant">Halo! Saya asisten AI Dinas Kesehatan Kabupaten Indragiri Hulu. Saya dapat menjawab pertanyaan tentang data kesehatan berdasarkan database terkini.

Contoh pertanyaan:
• Kecamatan mana dengan kasus TB tertinggi?
• Berapa total kasus stunting di seluruh kabupaten?
• Sebutkan data ibu hamil di Kecamatan Rengat.</div>
      </div>
      <div class="chat-quick-q" id="dashChatQuick">
        <button data-q="Kecamatan mana dengan kasus TB tertinggi?">Kecamatan mana dengan kasus TB tertinggi?</button>
        <button data-q="Berapa total kasus stunting di seluruh kabupaten?">Berapa total kasus stunting di seluruh kabupaten?</button>
        <button data-q="Sebutkan 3 kecamatan dengan ibu hamil terbanyak.">Sebutkan 3 kecamatan dengan ibu hamil terbanyak.</button>
        <button data-q="Bandingkan data TB dan stunting antar kecamatan.">Bandingkan data TB dan stunting antar kecamatan.</button>
      </div>
      <div class="chat-input-row">
        <input type="text" id="dashChatInput" placeholder="Ketik pertanyaan tentang data kesehatan...">
        <button id="dashChatSend">Kirim</button>
      </div>
    </div>
  `

  const input = document.getElementById('dashChatInput')
  const sendBtn = document.getElementById('dashChatSend')
  const messages = document.getElementById('dashChatMessages')

  async function send(question) {
    if (!question.trim()) return
    // Append user msg
    const userMsg = document.createElement('div')
    userMsg.className = 'chat-msg user'
    userMsg.textContent = question
    messages.appendChild(userMsg)

    input.value = ''
    sendBtn.disabled = true
    input.disabled = true

    // Typing indicator
    const typing = document.createElement('div')
    typing.className = 'chat-msg assistant chat-typing-dots'
    typing.innerHTML = '<span>•</span><span>•</span><span>•</span>'
    messages.appendChild(typing)
    messages.scrollTop = messages.scrollHeight

    try {
      const answer = await Chat.ask(question, 'dashboard')
      // Save to chat history
      await Api.saveChat(user.id, question, answer).catch(() => {})
      typing.remove()
      const ansMsg = document.createElement('div')
      ansMsg.className = 'chat-msg assistant'
      ansMsg.textContent = answer
      messages.appendChild(ansMsg)
    } catch (e) {
      typing.remove()
      const errMsg = document.createElement('div')
      errMsg.className = 'chat-msg assistant'
      errMsg.textContent = '⚠️ ' + safeErrorMessage(e)
      messages.appendChild(errMsg)
    } finally {
      sendBtn.disabled = false
      input.disabled = false
      input.focus()
      messages.scrollTop = messages.scrollHeight
    }
  }

  sendBtn.addEventListener('click', () => send(input.value))
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input.value)
    }
  })
  document.querySelectorAll('#dashChatQuick button').forEach((b) => {
    b.addEventListener('click', () => send(b.dataset.q))
  })
}

// ===========================================================================
// TAB: PENGATURAN
// ===========================================================================

async function renderSettingsTab(container, user) {
  showLoading(container)
  const settings = await Api.getSettings()

  container.innerHTML = `
    <div class="tab-header">
      <div>
        <h2>⚙️ Pengaturan</h2>
        <p>Konfigurasi API Key Groq, model AI, dan heading Excel.</p>
      </div>
    </div>

    <div id="settingsAlert"></div>

    <!-- GROQ AI -->
    <div class="settings-card">
      <h3>🤖 Pengaturan Groq AI</h3>
      <p class="desc">
        Sediakan API Key Groq untuk mengaktifkan fitur chat AI yang menjawab pertanyaan berdasarkan database.
        Dapatkan API Key gratis di <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">console.groq.com/keys</a>.
      </p>
      <div class="form-group">
        <label class="form-label">Groq API Key</label>
        <div class="api-key-input-group">
          <input type="password" class="form-input" id="groqApiKey" placeholder="gsk_..." value="${sanitizeAttr(settings.groq_api_key || '')}" maxlength="100">
          <button type="button" class="toggle-btn" id="toggleApiKey">👁️ Lihat</button>
        </div>
        <div class="text-tiny text-muted mt-2">
          API Key disimpan di tabel settings. Untuk keamanan penuh, deploy Edge Function (lihat README.md).
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Model Groq</label>
        <select class="form-select" id="groqModel">
          <option value="llama-3.3-70b-versatile" ${settings.groq_model === 'llama-3.3-70b-versatile' ? 'selected' : ''}>llama-3.3-70b-versatile (recommended)</option>
          <option value="llama-3.1-8b-instant" ${settings.groq_model === 'llama-3.1-8b-instant' ? 'selected' : ''}>llama-3.1-8b-instant (fast)</option>
          <option value="llama3-70b-8192" ${settings.groq_model === 'llama3-70b-8192' ? 'selected' : ''}>llama3-70b-8192</option>
          <option value="llama3-8b-8192" ${settings.groq_model === 'llama3-8b-8192' ? 'selected' : ''}>llama3-8b-8192</option>
          <option value="mixtral-8x7b-32768" ${settings.groq_model === 'mixtral-8x7b-32768' ? 'selected' : ''}>mixtral-8x7b-32768</option>
          <option value="gemma2-9b-it" ${settings.groq_model === 'gemma2-9b-it' ? 'selected' : ''}>gemma2-9b-it</option>
        </select>
      </div>
      <button class="btn btn-primary" id="saveGroq">Simpan Pengaturan AI</button>
    </div>

    <!-- EXCEL HEADING -->
    <div class="settings-card">
      <h3>📊 Heading Excel</h3>
      <p class="desc">Atur teks heading yang muncul di 3 baris pertama file Excel hasil export.</p>
      <div class="form-group">
        <label class="form-label">Baris Heading 1 (judul utama)</label>
        <input class="form-input" id="excelLine1" maxlength="100" value="${sanitizeAttr(settings.excel_heading_line1 || '')}" placeholder="PEMERINTAH KABUPATEN INDRAGIRI HULU">
      </div>
      <div class="form-group">
        <label class="form-label">Baris Heading 2 (dinas)</label>
        <input class="form-input" id="excelLine2" maxlength="100" value="${sanitizeAttr(settings.excel_heading_line2 || '')}" placeholder="DINAS KESEHATAN">
      </div>
      <div class="form-group">
        <label class="form-label">Baris Heading 3 (sub-judul data)</label>
        <input class="form-input" id="excelLine3" maxlength="100" value="${sanitizeAttr(settings.excel_heading_line3 || '')}" placeholder="DATA KASUS KESEHATAN KABUPATEN INDRAGIRI HULU">
      </div>
      <div class="preview">
        <p class="line1" id="preview1">(kosong)</p>
        <p class="line2" id="preview2">(kosong)</p>
        <p class="line3" id="preview3">(kosong)</p>
      </div>
      <button class="btn btn-primary mt-3" id="saveExcelHeading">Simpan Heading Excel</button>
    </div>

    <!-- SITE NAME -->
    <div class="settings-card">
      <h3>🌐 Nama Situs</h3>
      <p class="desc">Nama situs yang muncul di judul browser (tab title).</p>
      <div style="display: flex; gap: 8px;">
        <input class="form-input" id="siteName" maxlength="100" value="${sanitizeAttr(settings.site_name || '')}">
        <button class="btn btn-primary" id="saveSiteName">Simpan</button>
      </div>
    </div>
  `

  // Update preview on input
  function updatePreview() {
    document.getElementById('preview1').textContent = document.getElementById('excelLine1').value || '(kosong)'
    document.getElementById('preview2').textContent = document.getElementById('excelLine2').value || '(kosong)'
    document.getElementById('preview3').textContent = document.getElementById('excelLine3').value || '(kosong)'
  }
  ['excelLine1', 'excelLine2', 'excelLine3'].forEach((id) => {
    document.getElementById(id).addEventListener('input', updatePreview)
  })
  updatePreview()

  // Toggle API key visibility
  document.getElementById('toggleApiKey').addEventListener('click', () => {
    const inp = document.getElementById('groqApiKey')
    inp.type = inp.type === 'password' ? 'text' : 'password'
  })

  function showAlert(msg, type = 'success') {
    document.getElementById('settingsAlert').innerHTML = `<div class="alert alert-${type}">✅ ${msg}</div>`
    setTimeout(() => { document.getElementById('settingsAlert').innerHTML = '' }, 3000)
  }

  document.getElementById('saveGroq').addEventListener('click', async () => {
    const btn = document.getElementById('saveGroq')
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Menyimpan...'
    try {
      await Api.updateSettings({
        groq_api_key: document.getElementById('groqApiKey').value,
        groq_model: document.getElementById('groqModel').value,
      })
      showAlert('Pengaturan AI berhasil disimpan.')
    } catch (e) { alert(safeErrorMessage(e)) }
    finally {
      btn.disabled = false
      btn.textContent = 'Simpan Pengaturan AI'
    }
  })

  document.getElementById('saveExcelHeading').addEventListener('click', async () => {
    const btn = document.getElementById('saveExcelHeading')
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Menyimpan...'
    try {
      await Api.updateSettings({
        excel_heading_line1: document.getElementById('excelLine1').value,
        excel_heading_line2: document.getElementById('excelLine2').value,
        excel_heading_line3: document.getElementById('excelLine3').value,
      })
      showAlert('Heading Excel berhasil disimpan.')
    } catch (e) { alert(safeErrorMessage(e)) }
    finally {
      btn.disabled = false
      btn.textContent = 'Simpan Heading Excel'
    }
  })

  document.getElementById('saveSiteName').addEventListener('click', async () => {
    const btn = document.getElementById('saveSiteName')
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span>'
    try {
      await Api.updateSettings({ site_name: document.getElementById('siteName').value })
      showAlert('Nama situs berhasil disimpan.')
    } catch (e) { alert(safeErrorMessage(e)) }
    finally {
      btn.disabled = false
      btn.textContent = 'Simpan'
    }
  })
}
