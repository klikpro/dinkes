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
      c.district.name,
      c.district.latitude,
      c.district.longitude,
      c.subcategory.category.name,
      c.subcategory.name,
      c.subcategory.unit || '',
      c.value,
      c.period || '',
      c.notes || '',
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
