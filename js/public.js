/**
 * public.js — Logika halaman peta publik (index.html)
 */

let publicMap = null
let publicMarkerLayer = null
let publicMapData = null

document.addEventListener('DOMContentLoaded', async () => {
  // Init Supabase
  initSupabase()

  // Init map
  initPublicMap()

  // Load data
  await loadPublicMapData()

  // Setup chat FAB
  document.getElementById('chatFab').addEventListener('click', () => {
    Chat.openPublic()
  })
})

function initPublicMap() {
  publicMap = L.map('map', {
    minZoom: window.CONFIG.MAP_ZOOM,
    maxZoom: 19,
    zoomControl: true,
  }).setView(window.CONFIG.MAP_CENTER, window.CONFIG.MAP_ZOOM)

  // ===========================================================================
  // BASEMAP: beberapa pilihan gaya peta (semua gratis, tanpa API key)
  // ===========================================================================
  const layerVoyager = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { attribution: '© OpenStreetMap contributors © CARTO', subdomains: 'abcd', maxZoom: 20 }
  )

  const layerStreets = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap contributors', maxZoom: 19 }
  )

  const layerSatellite = L.layerGroup([
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics', maxZoom: 19 }
    ),
    // Layer label jalan & nama tempat di atas citra satelit
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, pane: 'shadowPane' }
    ),
  ])

  const layerTopo = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap contributors, SRTM © OpenTopoMap', subdomains: 'abc', maxZoom: 17 }
  )

  layerStreets.addTo(publicMap)

  L.control.layers(
    {
      '🛣️ Jalan (Standar)': layerStreets,
      '🗺️ Jalan (Modern)': layerVoyager,
      '🛰️ Satelit + Label': layerSatellite,
      '⛰️ Topografi': layerTopo,
    },
    null,
    { position: 'topright', collapsed: true }
  ).addTo(publicMap)

  // Boundary polygon (Kabupaten Indragiri Hulu — perkiraan)
  const boundary = window.CONFIG.MAP_BOUNDARY

  // Mask: putihkan area luar kabupaten (agar fokus ke Kab. Indragiri Hulu)
  const worldRing = [
    [-85, -360], [-85, 360], [85, 360], [85, -360],
  ]
  L.polygon([worldRing, boundary.slice().reverse()], {
    stroke: false,
    fillColor: '#ffffff',
    fillOpacity: 0.88,
    interactive: false,
  }).addTo(publicMap)

  L.polygon(boundary, {
    color: '#facc15',
    weight: 2.5,
    fill: false,
    dashArray: '6,4',
  })
    .addTo(publicMap)
    .bindTooltip('Batas Kabupaten Indragiri Hulu (perkiraan)', { sticky: true })

  publicMap.setMaxBounds(window.CONFIG.MAP_MAX_BOUNDS)
  publicMap.fitBounds(boundary, { padding: [20, 20] })

  publicMarkerLayer = L.layerGroup().addTo(publicMap)

  setTimeout(() => publicMap.invalidateSize(), 200)
  window.addEventListener('resize', () => publicMap.invalidateSize())
}

async function loadPublicMapData() {
  try {
    publicMapData = await Api.getPublicMapData()
    renderPublicMarkers()
    document.getElementById('mapLoading').style.display = 'none'
  } catch (e) {
    console.error('Failed to load map data', e)
    document.getElementById('mapLoading').innerHTML = `
      <div>
        <p style="color: #fca5a5; margin-bottom: 8px;">Gagal memuat data peta</p>
        <p style="font-size: 12px; opacity: 0.7;">${safeErrorMessage(e)}</p>
        <p style="font-size: 11px; opacity: 0.5; margin-top: 12px;">
          Pastikan Anda sudah menjalankan sql/schema.sql di Supabase SQL Editor.
        </p>
      </div>
    `
  }
}

function renderPublicMarkers() {
  if (!publicMapData || !publicMarkerLayer) return
  publicMarkerLayer.clearLayers()

  publicMapData.districts.forEach((d) => {
    const subIds = Object.keys(d.values)
    if (subIds.length === 0) {
      // No data — gray dot
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:18px;height:18px;border-radius:50%;
              background:#64748b;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      })
      const marker = L.marker([d.latitude, d.longitude], { icon }).addTo(publicMarkerLayer)
      marker.bindTooltip(
        `<div class="hs-wrap"><div class="hs-title">📍 ${d.name}</div><div class="hs-row"><span class="hs-name" style="opacity:.75">Belum ada data</span></div></div>`,
        { direction: 'top', offset: [0, -10], opacity: 0.97, className: 'district-hover-tooltip' }
      )
      marker.on('click', () => showDistrictDetail(d))
      return
    }

    // Find stunting value to determine marker color, else first available
    const stuntSub = publicMapData.subcategories.find(
      (s) => s.name.toLowerCase() === 'stunting'
    )
    const subId = (stuntSub && d.values[stuntSub.id] && stuntSub.id) || subIds[0]
    const v = d.values[subId]?.value || 0
    const color = riskColor(v, 18, 30)
    const label = riskLabel(v, 18, 30)

    const icon = L.divIcon({
      className: '',
      html: `
        <div style="position:relative;width:32px;height:32px;">
          <div class="pulse-ring-anim" style="position:absolute;left:0;top:0;width:32px;height:32px;border-radius:50%;background:${color};opacity:.7"></div>
          <div style="position:absolute;left:7px;top:7px;width:18px;height:18px;border-radius:50%;
            background:${color};border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)"></div>
        </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    })
    const marker = L.marker([d.latitude, d.longitude], { icon }).addTo(publicMarkerLayer)
    marker.bindTooltip(buildHoverSummaryHtml(d), {
      direction: 'top',
      offset: [0, -18],
      opacity: 0.97,
      className: 'district-hover-tooltip',
      sticky: false,
    })
    marker.on('click', () => showDistrictDetail(d))
  })
}

/**
 * Ringkasan hover: 6 data dengan nilai tertinggi (paling banyak kasus) di
 * kecamatan ini, plus keterangan untuk klik jika ingin detail lengkap.
 */
function buildHoverSummaryHtml(district) {
  const entries = Object.entries(district.values)
    .map(([subId, v]) => {
      const sc = publicMapData.subcategories.find((s) => s.id === subId)
      if (!sc) return null
      return { name: sc.name, unit: sc.unit || '', value: v.value, color: safeColor(sc.category.color) }
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)

  const rowsHtml =
    entries.length > 0
      ? entries
          .map(
            (e) => `
        <div class="hs-row">
          <span class="hs-dot" style="background:${e.color}"></span>
          <span class="hs-name">${sanitizeHtml(e.name)}</span>
          <span class="hs-value">${sanitizeHtml(e.value)}${e.unit ? ' ' + sanitizeHtml(e.unit) : ''}</span>
        </div>`
          )
          .join('')
      : `<div class="hs-row"><span class="hs-name" style="opacity:.7">Belum ada data</span></div>`

  return `
    <div class="hs-wrap">
      <div class="hs-title">📍 ${sanitizeHtml(district.name)}</div>
      ${rowsHtml}
      <div class="hs-hint">Klik untuk lihat detail lengkap →</div>
    </div>
  `
}

/**
 * Validate that a color value is a plain #rgb/#rrggbb hex color before
 * interpolating it into a `style="..."` attribute. Category colors are only
 * meant to be set via the <input type="color"> picker in the dashboard, but
 * this is rendered on the fully PUBLIC map page — if the stored value were
 * ever anything other than a clean hex color (bad data, a future bug, or a
 * compromised admin session), an unvalidated value could break out of the
 * style attribute in every visitor's browser. Falls back to a safe default.
 */
function safeColor(value) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value || '') ? value : '#065f46'
}

function riskColor(v, th1, th2) {
  return v >= th2 ? '#dc2626' : v >= th1 ? '#d97706' : '#059669'
}

function riskLabel(v, th1, th2) {
  return v >= th2 ? 'Tinggi' : v >= th1 ? 'Sedang' : 'Rendah'
}

function fmtDateSmall(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd} ${mm} ${yy}`
}

function showDistrictDetail(district) {
  // Group subcategories by category
  const byCat = {}
  publicMapData.subcategories.forEach((sc) => {
    if (!district.values[sc.id]) return
    if (!byCat[sc.category.id]) {
      byCat[sc.category.id] = { cat: sc.category, items: [] }
    }
    byCat[sc.category.id].items.push(sc)
  })

  const sectionsHtml = Object.values(byCat)
    .map(({ cat, items }) => `
      <div class="detail-section">
        <h3 style="color: ${safeColor(cat.color)}">
          <span class="color-dot" style="background: ${safeColor(cat.color)}"></span>
          ${sanitizeHtml(cat.name)}
        </h3>
        <div class="detail-grid">
          ${items
            .map((sc) => {
              const v = district.values[sc.id]
              return `
              <div class="detail-stat">
                <div class="label">${sanitizeHtml(sc.name)}</div>
                <div class="value">
                  ${sanitizeHtml(v.value)}
                  <span class="unit">${sanitizeHtml(sc.unit || '')}</span>
                </div>
                <div class="updated">Update: ${fmtDateSmall(v.updatedAt)}</div>
              </div>`
            })
            .join('')}
        </div>
      </div>
    `)
    .join('')

  const periodLabel = district.lastUpdate
    ? new Date(district.lastUpdate).toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'long',
      })
    : '-'

  const html = `
    <div class="detail-overlay" id="detailOverlay">
      <div class="detail-panel">
        <div class="detail-head">
          <button class="detail-close" id="detailCloseBtn">×</button>
          <h2>📍 Kecamatan ${sanitizeHtml(district.name)}</h2>
          <p>Kabupaten Indragiri Hulu, Provinsi Riau</p>
          ${
            district.lastUpdate
              ? `<p class="last-update">Data diperbarui: ${fmtDateSmall(district.lastUpdate)}</p>`
              : ''
          }
        </div>
        <div class="detail-body">
          ${
            Object.values(byCat).length === 0
              ? '<p class="text-center text-muted" style="padding: 32px;">Belum ada data untuk kecamatan ini.</p>'
              : sectionsHtml
          }
        </div>
        <div class="detail-foot">
          Data bersifat resmi Dinas Kesehatan Kabupaten Indragiri Hulu · Periode ${periodLabel}
        </div>
      </div>
    </div>
  `

  const container = document.getElementById('detailPanelContainer')
  container.innerHTML = html

  document.getElementById('detailOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'detailOverlay') closeDistrictDetail()
  })
  document.getElementById('detailCloseBtn').addEventListener('click', closeDistrictDetail)
}

function closeDistrictDetail() {
  document.getElementById('detailPanelContainer').innerHTML = ''
}
