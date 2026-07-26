/**
 * chat.js — AI Chat widget (dipakai di index.html dan dashboard.html)
 *
 * Strategi:
 * - Jika CONFIG.GROQ_EDGE_FUNCTION_URL di-set, panggil Edge Function (AMAN, key di server)
 * - Jika tidak, fallback ke client-side call (KURANG AMAN, key terlihat di network)
 * - API key untuk mode fallback diambil dari tabel settings (hanya super_admin yang bisa lihat)
 *
 * Untuk keamanan produksi, WAJIB deploy Edge Function (lihat README.md).
 */

const Chat = {
  isOpen: false,

  /**
   * Buka widget chat (untuk halaman publik).
   */
  openPublic() {
    this.open('public')
  },

  /**
   * Buka widget chat (untuk dashboard).
   */
  openDashboard() {
    this.open('dashboard')
  },

  /**
   * Render widget chat di container.
   * mode: 'public' | 'dashboard'
   */
  open(mode) {
    if (this.isOpen) return
    this.isOpen = true

    const container = document.getElementById(
      mode === 'public' ? 'chatWidgetContainer' : 'modalContainer'
    )
    if (!container) return

    const overlay = document.createElement('div')
    overlay.className = 'chat-widget-overlay'
    overlay.id = 'chatWidgetOverlay'
    overlay.innerHTML = `
      <div class="chat-widget" id="chatWidgetInner">
        <div class="chat-widget-head">
          <div class="info">
            <div class="avatar">🤖</div>
            <div>
              <div class="title">AI Dinkes Inhu</div>
              <div class="subtitle">Chat dengan data kesehatan</div>
            </div>
          </div>
          <button class="close-btn" id="chatCloseBtn">×</button>
        </div>
        <div class="chat-widget-body" id="chatWidgetBody">
          <div class="chat-msg assistant">Selamat datang di Asisten AI Dinkes Inhu. Saya siap menjawab pertanyaan Anda tentang data kesehatan di Kabupaten Indragiri Hulu berdasarkan database terkini. Apa yang ingin Anda ketahui?</div>
        </div>
        <div class="chat-widget-foot">
          <input type="text" id="chatInput" maxlength="500" placeholder="Ketik pertanyaan tentang data kesehatan...">
          <button id="chatSendBtn">Kirim</button>
        </div>
      </div>
    `
    overlay.addEventListener('click', () => this.close())
    container.appendChild(overlay)
    // Same CSP note as tabs.js openModal(): inline onclick attributes are
    // blocked by script-src (no 'unsafe-inline'), so stopPropagation must be
    // wired via addEventListener or every click inside the widget would
    // bubble to the overlay and close the chat immediately.
    document.getElementById('chatWidgetInner').addEventListener('click', (e) => e.stopPropagation())

    document.getElementById('chatCloseBtn').addEventListener('click', () => this.close())
    document.getElementById('chatSendBtn').addEventListener('click', () => this.send(mode))
    document.getElementById('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.send(mode)
    })
    document.getElementById('chatInput').focus()
  },

  close() {
    const overlay = document.getElementById('chatWidgetOverlay')
    if (overlay) overlay.remove()
    this.isOpen = false
  },

  async send(mode) {
    const input = document.getElementById('chatInput')
    const btn = document.getElementById('chatSendBtn')
    const body = document.getElementById('chatWidgetBody')
    const message = input.value.trim()
    if (!message) return

    // Validate message length (max 500 chars for safety)
    if (message.length > 500) {
      const errMsg = document.createElement('div')
      errMsg.className = 'chat-msg assistant'
      errMsg.textContent = 'Pesan terlalu panjang (maksimal 500 karakter).'
      body.appendChild(errMsg)
      body.scrollTop = body.scrollHeight
      return
    }

    // Append user message
    const userMsg = document.createElement('div')
    userMsg.className = 'chat-msg user'
    userMsg.textContent = message
    body.appendChild(userMsg)

    input.value = ''
    btn.disabled = true
    input.disabled = true

    // Append typing indicator
    const typing = document.createElement('div')
    typing.className = 'chat-msg assistant chat-typing-dots'
    typing.innerHTML = '<span>•</span><span>•</span><span>•</span>'
    body.appendChild(typing)
    body.scrollTop = body.scrollHeight

    try {
      const answer = await this.ask(message, mode)

      // Save to chat history (if logged in)
      const user = getCurrentUser()
      if (user) {
        Api.saveChat(user.id, message, answer).catch(() => {})
      }

      typing.remove()
      const ansMsg = document.createElement('div')
      ansMsg.className = 'chat-msg assistant'
      ansMsg.textContent = answer
      body.appendChild(ansMsg)
    } catch (e) {
      typing.remove()
      const errMsg = document.createElement('div')
      errMsg.className = 'chat-msg assistant'
      errMsg.textContent = '⚠️ ' + e.message
      body.appendChild(errMsg)
    } finally {
      btn.disabled = false
      input.disabled = false
      input.focus()
      body.scrollTop = body.scrollHeight
    }
  },

  /**
   * Kirim pertanyaan ke Groq AI.
   * - Jika EDGE_FUNCTION_URL di-set → panggil Edge Function (AMAN)
   * - Jika tidak → fallback client-side (KURANG AMAN, perlu API key di Pengaturan)
   */
  async ask(question, mode) {
    const edgeUrl = window.CONFIG.GROQ_EDGE_FUNCTION_URL

    if (edgeUrl) {
      // ====== Mode A: Edge Function (AMAN) ======
      const session = getSession()
      const headers = {
        'Content-Type': 'application/json',
        apikey: window.CONFIG.SUPABASE_ANON_KEY,
      }
      if (session) {
        headers.Authorization = `Bearer ${session.token}`
      }
      const r = await fetch(edgeUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: question, mode }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Edge Function error')
      return d.answer
    } else {
      // ====== Mode B: Client-side fallback (KURANG AMAN) ======
      // Ambil API key dari settings — gunakan getSettingsRaw() agar groq_api_key tidak di-mask
      // (public_settings view akan mengembalikan "***HIDDEN***" untuk non-super_admin)
      let settings
      try {
        settings = await Api.getSettingsRaw()
      } catch (e) {
        // If raw settings not accessible (non-super_admin), try masked view
        settings = await Api.getSettings()
      }
      const apiKey = settings.groq_api_key
      if (!apiKey) {
        throw new Error(
          'API Key Groq belum dikonfigurasi. Minta Super Admin untuk mengaturnya di menu Pengaturan, atau deploy Edge Function "chat" (lihat README.md).'
        )
      }
      const model = settings.groq_model || window.CONFIG.GROQ_DEFAULT_MODEL

      // Build context dari database
      const context = await this.buildContext(mode)

      const systemPrompt = `Anda adalah asisten AI Dinas Kesehatan Kabupaten Indragiri Hulu.

Tugas Anda:
- Menjawab pertanyaan pengguna BERDASARKAN DATA yang diberikan di bawah ini.
- Selalu merujuk pada data terbaru yang ada di database.
- Jika ditanya tentang kecamatan tertentu, sebutkan angka spesifik dari data.
- Jika data tidak tersedia untuk pertanyaan tersebut, katakan dengan jujur.
- Gunakan bahasa Indonesia formal pemerintahan.
- Jawab ringkas, jelas, dan padat (maksimal 4 paragraf).
- Jangan mengarang angka yang tidak ada di data.

${context}`

      const r = await fetch(window.CONFIG.GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question },
          ],
          temperature: 0.3,
          max_tokens: 1024,
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        throw new Error(
          `Groq API error (${r.status}). Periksa API key dan model di Pengaturan.`
        )
      }
      return d?.choices?.[0]?.message?.content || 'Maaf, tidak ada jawaban.'
    }
  },

  /**
   * Build context string dari database untuk system prompt.
   * mode 'public' = hanya kategori/subkategori aktif
   * mode 'dashboard' = sesuai permission user (atau semua jika super_admin)
   */
  async buildContext(mode) {
    const districts = await Api.getDistricts()
    const cats = await Api.getCategories()
    const activeCats = cats.filter((c) => c.is_active)

    // Filter subcategories yang aktif
    const activeSubs = activeCats.flatMap((c) =>
      c.subcategories.filter((s) => s.is_active)
    )

    // Ambil semua case records
    const cases = await Api.getCases()

    // Untuk mode dashboard non-super-admin, filter berdasarkan permission
    let visibleSubIds = null
    if (mode === 'dashboard') {
      const user = getCurrentUser()
      if (user && user.role !== 'super_admin') {
        visibleSubIds = new Set(
          (user.permissions || []).map((p) => p.subcategory_id)
        )
      }
    }

    const visibleSubs = visibleSubIds
      ? activeSubs.filter((s) => visibleSubIds.has(s.id))
      : activeSubs

    const visibleSubIdsSet = new Set(visibleSubs.map((s) => s.id))
    const visibleCases = cases.filter((c) => visibleSubIdsSet.has(c.subcategory_id))

    // Aggregate totals per subcategory
    const totals = {}
    visibleCases.forEach((c) => {
      totals[c.subcategory.name] = (totals[c.subcategory.name] || 0) + c.value
    })

    // Aggregate per district
    const byDistrict = {}
    visibleCases.forEach((c) => {
      if (!byDistrict[c.district.name]) byDistrict[c.district.name] = {}
      byDistrict[c.district.name][c.subcategory.name] = c.value
    })

    const lines = []
    lines.push('DATA KESEHATAN KABUPATEN INDRAGIRI HULU (ringkasan):')
    lines.push(`- Jumlah kecamatan: ${districts.length}`)
    lines.push(`- Jumlah kategori aktif: ${activeCats.length}`)
    lines.push('')
    lines.push('KATEGORI & SUBKATEGORI:')
    activeCats.forEach((cat) => {
      const subs = cat.subcategories
        .filter((s) => s.is_active && (!visibleSubIds || visibleSubIds.has(s.id)))
        .map((s) => s.name + (s.unit ? ` (${s.unit})` : ''))
      if (subs.length) {
        lines.push(`• ${cat.name}: ${subs.join(', ')}`)
      }
    })
    lines.push('')
    lines.push('TOTAL PER SUBKATEGORI (seluruh kabupaten):')
    Object.entries(totals).forEach(([sub, total]) => {
      lines.push(`• ${sub}: ${total}`)
    })
    lines.push('')
    lines.push('DATA PER KECAMATAN:')
    districts.forEach((d) => {
      const vals = byDistrict[d.name]
      if (!vals || Object.keys(vals).length === 0) {
        lines.push(`• ${d.name}: (belum ada data)`)
      } else {
        const parts = Object.entries(vals).map(([k, v]) => `${k}=${v}`)
        lines.push(`• ${d.name}: ${parts.join(', ')}`)
      }
    })

    return lines.join('\n')
  },
}

window.Chat = Chat
