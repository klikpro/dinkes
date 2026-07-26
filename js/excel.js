/**
 * excel.js — Excel import/export client-side (menggunakan SheetJS / xlsx)
 *
 * Export: Ambil data dari Supabase, buat file .xlsx dengan heading kustom
 * Import: Parse file .xlsx, validasi, upsert ke Supabase
 *
 * Catatan: SheetJS harus sudah dimuat sebelum dipakai (lihat dashboard.html)
 */

const ExcelIO = {
  /**
   * Neutralize CSV/Excel formula injection. If a cell's text starts with
   * =, +, -, @, tab, or CR — characters Excel/Sheets/LibreOffice treat as
   * the start of a formula — prefix it with a leading apostrophe so it's
   * always rendered as plain text instead of being evaluated. Without this,
   * a "Catatan" (notes) field like `=HYPERLINK("http://evil","click")` or
   * a DDE payload entered by any user with case-input permission would be
   * evaluated when a super_admin later opens the exported file in Excel.
   */
  sanitizeCell(value) {
    if (typeof value !== 'string') return value
    if (/^[=+\-@\t\r]/.test(value)) return "'" + value
    return value
  },

  /**
   * Buat & unduh file Excel CONTOH/TEMPLATE untuk import — HANYA berisi data
   * kasus (satu sheet, bersih & rapi), dibuat langsung dari data Kecamatan
   * dan Kategori/Subkategori yang SEDANG ADA di database saat tombol diklik.
   *
   * Jika user bukan super_admin, contoh HANYA menampilkan kategori/subkategori
   * yang memang diizinkan untuk user tersebut — supaya template yang diunduh
   * selalu konsisten dengan apa yang benar-benar bisa diimpor olehnya (lihat
   * validasi permission yang sama persis di import()).
   */
  async downloadTemplate(user) {
    const [districts, categories] = await Promise.all([
      Api.getDistricts(),
      Api.getCategories(),
    ])
    const activeCats = categories.filter((c) => c.is_active)
    let subcats = activeCats.flatMap((c) =>
      c.subcategories.filter((s) => s.is_active).map((s) => ({ ...s, categoryName: c.name }))
    )

    // Batasi contoh hanya ke subkategori yang diizinkan untuk user (non-super-admin)
    if (user && user.role !== 'super_admin') {
      const allowedIds = new Set((user.permissions || []).map((p) => p.subcategory_id))
      subcats = subcats.filter((s) => allowedIds.has(s.id))
      if (subcats.length === 0) {
        throw new Error('Anda belum memiliki izin akses ke kategori/subkategori manapun, sehingga tidak ada contoh yang bisa dibuat. Hubungi super admin untuk memberikan akses.')
      }
    }

    const period = new Date().toISOString().slice(0, 7) // YYYY-MM bulan ini
    const exampleDistrict = districts[0] || { name: '(belum ada kecamatan)' }
    const validDistrictNames = districts.map((d) => d.name).join(', ') || '(belum ada kecamatan)'

    const headers = ['Kecamatan', 'Kategori', 'Subkategori', 'Nilai', 'Periode', 'Catatan']

    const dataRows =
      subcats.length > 0
        ? subcats.map((s) => [
            exampleDistrict.name,
            s.categoryName,
            s.name,
            0,
            period,
            'Ganti Kecamatan & Nilai sesuai data asli',
          ])
        : [['(belum ada subkategori yang bisa diimpor)', '', '', '', '', '']]

    const title = 'CONTOH / TEMPLATE IMPORT DATA KASUS KESEHATAN'
    const subtitle = (user && user.role !== 'super_admin')
      ? `Hanya menampilkan kategori sesuai izin akses Anda · dibuat ${new Date().toLocaleDateString('id-ID')}`
      : `Dibuat otomatis dari data terkini · ${new Date().toLocaleDateString('id-ID')}`
    const info1 = `Kecamatan valid: ${validDistrictNames}`
    const info2 = 'Wajib diisi: Kecamatan, Subkategori, Nilai (angka). Kategori/Periode/Catatan opsional. Hapus baris contoh lalu isi data asli — jika kombinasi Kecamatan+Subkategori+Periode sudah ada, data akan diperbarui (update), jika belum akan dibuat baru (insert).'

    const headerRowIdx = 4 // baris ke-5 (0-indexed 4)
    const aoa = [
      [title],
      [subtitle],
      [info1],
      [info2],
      headers,
      ...dataRows,
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)

    // Layout rapi: lebar kolom pas, judul di-merge, baris header dibekukan + filter
    ws['!cols'] = [
      { wch: 22 }, { wch: 24 }, { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 42 },
    ]
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: headers.length - 1 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: headers.length - 1 } },
    ]
    ws['!rows'] = [
      { hpt: 22 }, { hpt: 16 }, { hpt: 16 }, { hpt: 30 }, { hpt: 18 },
    ]
    ws['!freeze'] = { xSplit: 0, ySplit: headerRowIdx + 1 }
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range(
        { r: headerRowIdx, c: 0 },
        { r: headerRowIdx, c: headers.length - 1 }
      ),
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Data Kasus')
    XLSX.writeFile(wb, 'contoh-template-import-data-kasus.xlsx')
  },

  /**
   * Export semua case records (yang user punya akses) ke file Excel.
   */
  async export(user) {
    // Ambil data + settings
    const [cases, settings] = await Promise.all([
      Api.getCases(),
      Api.getSettings(),
    ])

    // Filter berdasarkan permission (untuk non-super-admin)
    let visibleCases = cases
    if (user.role !== 'super_admin') {
      const allowedSubIds = new Set(
        (user.permissions || []).map((p) => p.subcategory_id)
      )
      visibleCases = cases.filter((c) => allowedSubIds.has(c.subcategory_id))
    }

    const headingLines = [
      settings.excel_heading_line1 || '',
      settings.excel_heading_line2 || '',
      settings.excel_heading_line3 || '',
      '',
    ]

    const headers = [
      'Kecamatan', 'Latitude', 'Longitude',
      'Kategori', 'Subkategori', 'Satuan',
      'Nilai', 'Periode', 'Catatan', 'Tanggal Update',
    ]

    const dataRows = visibleCases.map((c) => [
      this.sanitizeCell(c.district.name),
      c.district.latitude,
      c.district.longitude,
      this.sanitizeCell(c.subcategory.category.name),
      this.sanitizeCell(c.subcategory.name),
      this.sanitizeCell(c.subcategory.unit || ''),
      c.value,
      this.sanitizeCell(c.period || ''),
      this.sanitizeCell(c.notes || ''),
      c.updated_at ? new Date(c.updated_at).toISOString().slice(0, 19).replace('T', ' ') : '',
    ])

    const aoa = [...headingLines.map((h) => [h]), headers, ...dataRows]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [
      { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 18 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 30 }, { wch: 22 },
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Data Kasus')

    const filename = `data-kasus-kesehatan-${new Date().toISOString().slice(0, 10)}.xlsx`
    XLSX.writeFile(wb, filename)
  },

  /**
   * Import case records dari file Excel.
   * Format: baris 1-3 boleh heading, baris header wajib ada minimal
   *   "Kecamatan", "Subkategori", "Nilai". Opsional: "Periode", "Catatan".
   */
  async import(file, user) {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const sheetName = wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]

    // Convert ke array 2D
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
    if (aoa.length === 0) throw new Error('File Excel kosong.')

    // Cari baris header (dalam 6 baris pertama, cari "Kecamatan")
    let headerRowIdx = -1
    for (let i = 0; i < Math.min(6, aoa.length); i++) {
      if (aoa[i].some((c) => String(c).trim().toLowerCase() === 'kecamatan')) {
        headerRowIdx = i
        break
      }
    }
    if (headerRowIdx === -1) {
      throw new Error('Kolom "Kecamatan" tidak ditemukan dalam 6 baris pertama.')
    }

    const headers = aoa[headerRowIdx].map((h) => String(h).trim().toLowerCase())
    const colMap = {}
    headers.forEach((h, i) => (colMap[h] = i))

    const requiredCols = ['kecamatan', 'subkategori', 'nilai']
    for (const c of requiredCols) {
      if (colMap[c] === undefined) {
        throw new Error(`Kolom "${c}" wajib ada di file Excel.`)
      }
    }

    // Pre-load districts & subcategories
    const [districts, categories] = await Promise.all([
      Api.getDistricts(),
      Api.getCategories(),
    ])
    const subcats = categories.flatMap((c) => c.subcategories)
    const distByName = {}
    districts.forEach((d) => (distByName[d.name.toLowerCase()] = d))
    const subByName = {}
    subcats.forEach((s) => (subByName[s.name.toLowerCase()] = s))

    // Untuk non-super-admin, cek permission per subcategory. Setiap baris yang
    // kategorinya TIDAK termasuk dalam daftar izin akses user akan DITOLAK
    // (tidak diimpor) — lihat pengecekan userPermIds di loop bawah.
    let userPermIds = null
    if (user.role !== 'super_admin') {
      userPermIds = new Set((user.permissions || []).map((p) => p.subcategory_id))
      if (userPermIds.size === 0) {
        throw new Error('Anda tidak memiliki izin akses ke kategori/subkategori manapun, sehingga tidak ada data yang bisa diimpor. Hubungi super admin.')
      }
    }

    const dataRows = aoa.slice(headerRowIdx + 1).filter((r) =>
      r.some((c) => String(c).trim() !== '')
    )

    const imported = []
    const errors = []

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i]
      const rowNum = headerRowIdx + 2 + i
      const distName = String(row[colMap['kecamatan']] || '').trim()
      const subName = String(row[colMap['subkategori']] || '').trim()
      const valueRaw = row[colMap['nilai']]
      const value = Number(valueRaw)
      const period = colMap['periode'] !== undefined
        ? String(row[colMap['periode']] || '').trim() || null
        : null
      const notes = colMap['catatan'] !== undefined
        ? String(row[colMap['catatan']] || '').trim() || null
        : null

      if (!distName || !subName || isNaN(value)) {
        errors.push({ row: rowNum, message: 'Data tidak lengkap (kecamatan/subkategori/nilai)' })
        continue
      }
      const district = distByName[distName.toLowerCase()]
      if (!district) {
        errors.push({ row: rowNum, message: `Kecamatan "${distName}" tidak ditemukan` })
        continue
      }
      const sub = subByName[subName.toLowerCase()]
      if (!sub) {
        errors.push({ row: rowNum, message: `Subkategori "${subName}" tidak ditemukan` })
        continue
      }
      if (userPermIds && !userPermIds.has(sub.id)) {
        errors.push({ row: rowNum, message: `Tidak ada izin untuk subkategori "${subName}"` })
        continue
      }

      try {
        await Api.upsertCase(
          {
            district_id: district.id,
            subcategory_id: sub.id,
            value,
            period,
            notes,
          },
          user.id
        )
        imported.push({ rowNum })
      } catch (e) {
        errors.push({ row: rowNum, message: e.message })
      }
    }

    return { imported: imported.length, errors }
  },
}

window.ExcelIO = ExcelIO
