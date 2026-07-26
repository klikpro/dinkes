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
   * Buat & unduh file Excel CONTOH/TEMPLATE untuk import, dibuat langsung
   * dari data Kecamatan dan Kategori/Subkategori yang SEDANG ADA di database
   * saat tombol diklik — sehingga selalu sinkron dengan data terbaru,
   * tidak pernah kadaluarsa meskipun kategori/subkategori berubah.
   */
  async downloadTemplate() {
    const [districts, categories] = await Promise.all([
      Api.getDistricts(),
      Api.getCategories(),
    ])
    const activeCats = categories.filter((c) => c.is_active)
    const subcats = activeCats.flatMap((c) =>
      c.subcategories.filter((s) => s.is_active).map((s) => ({ ...s, categoryName: c.name }))
    )

    const period = new Date().toISOString().slice(0, 7) // YYYY-MM bulan ini

    // ---- Sheet 1: Data Kasus (contoh siap-pakai) ----
    const headers = ['Kecamatan', 'Kategori', 'Subkategori', 'Nilai', 'Periode', 'Catatan']
    const exampleDistrict = districts[0] || { name: '(belum ada kecamatan)' }

    const dataRows =
      subcats.length > 0
        ? subcats.map((s) => [
            exampleDistrict.name,
            s.categoryName,
            s.name,
            0,
            period,
            'CONTOH — ganti nilai & baris ini dengan data asli, lalu tambahkan baris untuk kecamatan lain',
          ])
        : [['(belum ada subkategori di database — buat dulu di menu Kategori & Subkategori)', '', '', '', '', '']]

    const aoa1 = [
      ['CONTOH / TEMPLATE IMPORT DATA KASUS KESEHATAN'],
      ['Dibuat otomatis berdasarkan data Kecamatan & Subkategori terkini pada ' + new Date().toLocaleDateString('id-ID')],
      [],
      headers,
      ...dataRows,
    ]
    const ws1 = XLSX.utils.aoa_to_sheet(aoa1)
    ws1['!cols'] = [
      { wch: 20 }, { wch: 22 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 50 },
    ]

    // ---- Sheet 2: Daftar Kecamatan valid ----
    const aoa2 = [
      ['DAFTAR NAMA KECAMATAN YANG VALID (harus ditulis persis sama di kolom "Kecamatan")'],
      [],
      ['Nama Kecamatan'],
      ...districts.map((d) => [d.name]),
    ]
    const ws2 = XLSX.utils.aoa_to_sheet(aoa2)
    ws2['!cols'] = [{ wch: 28 }]

    // ---- Sheet 3: Daftar Kategori & Subkategori valid ----
    const aoa3 = [
      ['DAFTAR KATEGORI & SUBKATEGORI YANG VALID (kolom "Subkategori" harus ditulis persis sama)'],
      [],
      ['Kategori', 'Subkategori', 'Satuan'],
      ...subcats.map((s) => [s.categoryName, s.name, s.unit || '']),
    ]
    const ws3 = XLSX.utils.aoa_to_sheet(aoa3)
    ws3['!cols'] = [{ wch: 24 }, { wch: 22 }, { wch: 12 }]

    // ---- Sheet 4: Petunjuk ----
    const aoa4 = [
      ['PETUNJUK PENGISIAN'],
      [],
      ['1. Kolom WAJIB diisi: Kecamatan, Subkategori, Nilai. Kolom Kategori, Periode, Catatan opsional.'],
      ['2. Nama Kecamatan & Subkategori harus PERSIS SAMA (tidak peka huruf besar/kecil) dengan'],
      ['   daftar valid di sheet "Daftar Kecamatan" dan "Daftar Kategori & Subkategori".'],
      ['3. Kolom Nilai harus berupa angka saja (tanpa satuan/teks).'],
      ['4. Format Periode disarankan YYYY-MM, contoh: ' + period + '.'],
      ['5. Jika kombinasi Kecamatan + Subkategori + Periode sudah ada, data akan DIPERBARUI (update).'],
      ['   Jika belum ada, akan dibuat data baru (insert).'],
      ['6. Hapus baris CONTOH di sheet "Data Kasus" sebelum mengimpor data asli, lalu tambahkan'],
      ['   baris sebanyak yang dibutuhkan (satu baris = satu kecamatan + satu subkategori).'],
      ['7. File ini dibuat otomatis dari data yang ada di database saat tombol diklik — jika Anda'],
      ['   menambah/mengubah kategori atau kecamatan, unduh ulang template ini agar tetap sinkron.'],
    ]
    const ws4 = XLSX.utils.aoa_to_sheet(aoa4)
    ws4['!cols'] = [{ wch: 90 }]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws1, 'Data Kasus')
    XLSX.utils.book_append_sheet(wb, ws2, 'Daftar Kecamatan')
    XLSX.utils.book_append_sheet(wb, ws3, 'Daftar Kategori & Subkategori')
    XLSX.utils.book_append_sheet(wb, ws4, 'Petunjuk')

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

    // Untuk non-super-admin, cek permission per subcategory
    let userPermIds = null
    if (user.role !== 'super_admin') {
      userPermIds = new Set((user.permissions || []).map((p) => p.subcategory_id))
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
