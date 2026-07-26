/**
 * supabase.js — Inisialisasi Supabase client dan helper API
 *
 * Semua operasi database dilakukan melalui objek `window.sb` (Supabase client)
 * dan `window.Api` (helper functions untuk operasi yang sering dipakai).
 */

// Load Supabase JS client dari CDN (lihat index.html / dashboard.html)
// Setelah load, window.supabase tersedia

let supabaseClient = null

/**
 * Inisialisasi Supabase client. Dipanggil otomatis di setiap halaman.
 */
function initSupabase() {
  if (supabaseClient) return supabaseClient
  if (typeof window.supabase === 'undefined') {
    console.error('Supabase JS client belum dimuat. Pastikan script CDN ada di HTML.')
    return null
  }
  supabaseClient = window.supabase.createClient(
    window.CONFIG.SUPABASE_URL,
    window.CONFIG.SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false }, // kita kelola session sendiri
    }
  )
  window.sb = supabaseClient
  return supabaseClient
}

/**
 * CATATAN (diperbarui): Aplikasi ini memakai sistem login sendiri (tabel
 * `users` + fungsi `verify_login`), tetapi token sesi SEKARANG adalah JWT
 * yang benar-benar ditandatangani dengan JWT secret asli project Supabase
 * (lihat supabase-functions/auth-login/index.ts). Karena tanda tangannya
 * valid, PostgREST akan menerimanya sebagai role `authenticated` dan
 * `auth.jwt()` akan berisi user_metadata yang benar — sehingga RLS policy
 * `to authenticated` di schema_secure.sql benar-benar berfungsi.
 *
 * SEBELUMNYA token ini dibuat & ditandatangani di browser memakai anon key
 * sebagai secret (yang PUBLIK), lalu sengaja TIDAK PERNAH dikirim karena
 * akan ditolak Supabase. Itu berarti semua request selalu berjalan sebagai
 * `anon`, dan sekaligus siapa pun bisa memalsukan JWT super_admin karena
 * anon key bisa dilihat semua orang. Jangan kembalikan perilaku lama ini.
 */
function setSupabaseAuth(sessionToken) {
  if (!supabaseClient) return
  if (sessionToken) {
    supabaseClient.rest.headers = {
      ...supabaseClient.rest.headers,
      apikey: window.CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${sessionToken}`,
    }
  } else {
    supabaseClient.rest.headers = {
      ...supabaseClient.rest.headers,
      apikey: window.CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${window.CONFIG.SUPABASE_ANON_KEY}`,
    }
  }
}

// ===========================================================================
// API HELPERS
// ===========================================================================

const Api = {
  // -------- DISTRICTS --------
  async getDistricts() {
    const { data, error } = await sb.from('districts').select('*').order('name')
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    return data
  },

  async createDistrict(payload) {
    const { data, error } = await sb
      .from('districts')
      .insert(payload)
      .select()
      .single()
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    return data
  },

  async updateDistrict(id, payload) {
    const { data, error } = await sb
      .from('districts')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    return data
  },

  async deleteDistrict(id) {
    const { error } = await sb.from('districts').delete().eq('id', id)
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
  },

  // -------- CATEGORIES & SUBCATEGORIES --------
  async getCategories() {
    const { data, error } = await sb
      .from('categories')
      .select('*, subcategories(*)')
      .order('sort_order')
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    // Sort subcategories
    data.forEach((c) => c.subcategories.sort((a, b) => a.sort_order - b.sort_order))
    return data
  },

  async createCategory(payload) {
    const { data, error } = await sb
      .from('categories')
      .insert(payload)
      .select('*, subcategories(*)')
      .single()
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    return data
  },

  async updateCategory(id, payload) {
    const { data, error } = await sb
      .from('categories')
      .update(payload)
      .eq('id', id)
      .select('*, subcategories(*)')
      .single()
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    data.subcategories.sort((a, b) => a.sort_order - b.sort_order)
    return data
  },

  async deleteCategory(id) {
    const { error } = await sb.from('categories').delete().eq('id', id)
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
  },

  async createSubcategory(categoryId, payload) {
    const { data, error } = await sb
      .from('subcategories')
      .insert({ ...payload, category_id: categoryId })
      .select('*, category(*)')
      .single()
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    return data
  },

  async updateSubcategory(id, payload) {
    const { data, error } = await sb
      .from('subcategories')
      .update(payload)
      .eq('id', id)
      .select('*, category(*)')
      .single()
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    return data
  },

  async deleteSubcategory(id) {
    const { error } = await sb.from('subcategories').delete().eq('id', id)
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
  },

  // -------- CASE RECORDS --------
  async getCases(filters = {}) {
    let q = sb
      .from('case_records')
      .select('*, district:districts(*), subcategory:subcategories(*, category:categories(*))')
      .order('updated_at', { ascending: false })
    if (filters.districtId) q = q.eq('district_id', filters.districtId)
    if (filters.subcategoryId) q = q.eq('subcategory_id', filters.subcategoryId)
    const { data, error } = await q
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    // Sort by district name then subcategory name
    data.sort(
      (a, b) =>
        a.district.name.localeCompare(b.district.name) ||
        a.subcategory.name.localeCompare(b.subcategory.name)
    )
    return data
  },

  /**
   * Upsert case record: jika ada record untuk district+subcategory+period, update.
   * Jika tidak, insert baru.
   */
  async upsertCase(payload, userId) {
    // Cari existing record
    const { data: existing } = await sb
      .from('case_records')
      .select('id')
      .eq('district_id', payload.district_id)
      .eq('subcategory_id', payload.subcategory_id)
      .eq('period', payload.period || null)
      .maybeSingle()

    if (existing) {
      const { data, error } = await sb
        .from('case_records')
        .update({
          value: payload.value,
          notes: payload.notes,
          updated_by: userId,
        })
        .eq('id', existing.id)
        .select('*, district:districts(*), subcategory:subcategories(*, category:categories(*))')
        .single()
      if (error) throw new Error(safeErrorMessage({ message: error.message }))
      return data
    } else {
      const { data, error } = await sb
        .from('case_records')
        .insert({
          district_id: payload.district_id,
          subcategory_id: payload.subcategory_id,
          value: payload.value,
          period: payload.period,
          notes: payload.notes,
          created_by: userId,
          updated_by: userId,
        })
        .select('*, district:districts(*), subcategory:subcategories(*, category:categories(*))')
        .single()
      if (error) throw new Error(safeErrorMessage({ message: error.message }))
      return data
    }
  },

  async updateCase(id, payload, userId) {
    const { data, error } = await sb
      .from('case_records')
      .update({ ...payload, updated_by: userId })
      .eq('id', id)
      .select('*, district:districts(*), subcategory:subcategories(*, category:categories(*))')
      .single()
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    return data
  },

  async deleteCase(id) {
    const { error } = await sb.from('case_records').delete().eq('id', id)
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
  },

  // -------- USERS --------
  async getUsers() {
    const { data, error } = await sb
      .from('users')
      .select('*, permissions:user_permissions(*, subcategory:subcategories(*, category:categories(*)))')
      .order('created_at', { ascending: false })
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    return data
  },

  async createUser(payload) {
    // Hash password di server via SQL function (atau langsung pakai crypt())
    // Karena anon key tidak bisa panggil gen_salt() langsung, kita gunakan RPC
    const { data: hashData, error: hashError } = await sb.rpc('hash_password', {
      p_password: payload.password,
    })
    if (hashError) throw hashError

    const { data, error } = await sb
      .from('users')
      .insert({
        email: payload.email.toLowerCase().trim(),
        name: payload.name,
        password_hash: hashData,
        role: payload.role || 'user',
        is_active: payload.is_active !== false,
      })
      .select('*, permissions:user_permissions(*, subcategory:subcategories(*, category:categories(*)))')
      .single()
    if (error) throw new Error(safeErrorMessage({ message: error.message }))

    // Insert permissions jika ada
    if (payload.permissions && payload.permissions.length > 0 && data.role !== 'super_admin') {
      const permRows = payload.permissions.map((p) => ({
        user_id: data.id,
        subcategory_id: p.subcategory_id,
        can_input: p.can_input !== false,
      }))
      const { error: permError } = await sb.from('user_permissions').insert(permRows)
      if (permError) throw permError
      // Reload to get permissions
      return await this.getUser(data.id)
    }
    return data
  },

  async getUser(id) {
    const { data, error } = await sb
      .from('users')
      .select('*, permissions:user_permissions(*, subcategory:subcategories(*, category:categories(*)))')
      .eq('id', id)
      .single()
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    return data
  },

  async updateUser(id, payload) {
    const updateData = {}
    if (payload.name !== undefined) updateData.name = payload.name
    if (payload.email !== undefined)
      updateData.email = payload.email.toLowerCase().trim()
    if (payload.role !== undefined) updateData.role = payload.role
    if (payload.is_active !== undefined) updateData.is_active = payload.is_active

    if (payload.password) {
      // Hash new password via SQL function
      const { data: hashData, error: hashError } = await sb.rpc('hash_password', {
        p_password: payload.password,
      })
      if (hashError) throw hashError
      updateData.password_hash = hashData
    }

    const { data, error } = await sb
      .from('users')
      .update(updateData)
      .eq('id', id)
      .select('*, permissions:user_permissions(*, subcategory:subcategories(*, category:categories(*)))')
      .single()
    if (error) throw new Error(safeErrorMessage({ message: error.message }))

    // Update permissions if provided
    if (payload.permissions !== undefined) {
      await sb.from('user_permissions').delete().eq('user_id', id)
      if (payload.permissions.length > 0 && data.role !== 'super_admin') {
        const permRows = payload.permissions.map((p) => ({
          user_id: id,
          subcategory_id: p.subcategory_id,
          can_input: p.can_input !== false,
        }))
        const { error: permError } = await sb.from('user_permissions').insert(permRows)
        if (permError) throw permError
      }
      return await this.getUser(id)
    }
    return data
  },

  async deleteUser(id) {
    const { error } = await sb.from('users').delete().eq('id', id)
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
  },

  // -------- SELF-SERVICE PASSWORD CHANGE --------
  async changeOwnPassword(oldPassword, newPassword) {
    const { error } = await sb.rpc('change_own_password', {
      p_old_password: oldPassword,
      p_new_password: newPassword,
    })
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    return true
  },

  // -------- SETTINGS --------
  // IMPORTANT: Uses public_settings view which masks groq_api_key for non-super_admin.
  // For super_admin operations that need the real key, use getSettingsRaw().
  async getSettings() {
    // Try public_settings view first (masked version). Note: a missing
    // table/view does NOT throw in supabase-js — it comes back as
    // { data: null, error }, so we must check `error`, not rely on catch.
    let { data, error } = await sb.from('public_settings').select('key, value')
    if (error) {
      // Fallback to raw settings table if the view doesn't exist yet (pre-schema_secure)
      const result = await sb.from('settings').select('key, value')
      data = result.data
      error = result.error
    }
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    const map = {}
    data.forEach((s) => (map[s.key] = s.value))
    return map
  },

  // Get raw settings (unmasked) — only works for super_admin due to RLS
  async getSettingsRaw() {
    const { data, error } = await sb.from('settings').select('key, value')
    if (error) throw new Error(safeErrorMessage({ message: error.message }))
    const map = {}
    data.forEach((s) => (map[s.key] = s.value))
    return map
  },

  async updateSettings(settingsObj) {
    // Upsert each setting
    const updates = Object.entries(settingsObj).map(async ([key, value]) => {
      const { error } = await sb
        .from('settings')
        .upsert({ key, value: String(value) }, { onConflict: 'key' })
      if (error) throw new Error(safeErrorMessage({ message: error.message }))
    })
    await Promise.all(updates)
    return await this.getSettings()
  },

  // -------- CHAT HISTORY --------
  async saveChat(userId, question, answer) {
    if (!userId) return
    const { error } = await sb
      .from('chat_history')
      .insert({ user_id: userId, question, answer })
    if (error) console.warn('Could not save chat history:', error.message)
  },

  // -------- PUBLIC MAP DATA (single aggregated call) --------
  async getPublicMapData() {
    const [districts, subcategories, cases] = await Promise.all([
      sb.from('districts').select('*').order('name'),
      sb
        .from('subcategories')
        .select('*, category:categories(*)')
        .eq('is_active', true)
        .eq('category.is_active', true)
        .order('sort_order'),
      sb
        .from('case_records')
        .select('*, subcategory:subcategories!inner(*, category:categories!inner(*))')
        .eq('subcategory.is_active', true)
        .eq('subcategory.category.is_active', true)
        .order('updated_at', { ascending: false }),
    ])

    if (districts.error) throw districts.error
    if (subcategories.error) throw subcategories.error
    if (cases.error) throw cases.error

    // Group cases by district
    const casesByDistrict = {}
    cases.data.forEach((c) => {
      if (!casesByDistrict[c.district_id]) casesByDistrict[c.district_id] = []
      casesByDistrict[c.district_id].push(c)
    })

    // Build result: districts with their values + last update
    const result = districts.data.map((d) => {
      const distCases = casesByDistrict[d.id] || []
      const values = {}
      let lastUpdate = null
      subcategories.data.forEach((sc) => {
        const rec = distCases.find((c) => c.subcategory_id === sc.id)
        if (rec) {
          values[sc.id] = {
            value: rec.value,
            unit: sc.unit,
            updatedAt: rec.updated_at,
            period: rec.period,
          }
          if (!lastUpdate || new Date(rec.updated_at) > new Date(lastUpdate)) {
            lastUpdate = rec.updated_at
          }
        }
      })
      return {
        id: d.id,
        name: d.name,
        latitude: d.latitude,
        longitude: d.longitude,
        values,
        lastUpdate,
      }
    })

    return {
      districts: result,
      subcategories: subcategories.data.map((sc) => ({
        id: sc.id,
        name: sc.name,
        unit: sc.unit,
        category: {
          id: sc.category.id,
          name: sc.category.name,
          color: sc.category.color,
          icon: sc.category.icon,
        },
      })),
    }
  },
}

window.initSupabase = initSupabase
window.setSupabaseAuth = setSupabaseAuth
window.Api = Api
