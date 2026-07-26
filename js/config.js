/**
 * config.js — Konfigurasi global untuk Peta Kesehatan Kabupaten Indragiri Hulu
 *
 * File ini berisi konfigurasi Supabase dan pengaturan lainnya.
 * Edit nilai di bawah sesuai project Supabase Anda.
 */

window.CONFIG = {
  // ===========================================================================
  // SUPABASE CONFIG
  // ===========================================================================
  // Project URL dan anon public key dari Supabase Dashboard
  // Dashboard → Settings → API
  // CATATAN: Kredensial admin hanya ada di SQL seed data, TIDAK di client-side code.
  SUPABASE_URL: 'https://aqxllawmskworpovcofq.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_9RzSGDpI_mxUZDY7FRL6_Q_xHXS8aLh',

  // ===========================================================================
  // AUTH LOGIN EDGE FUNCTION URL (REQUIRED — see README "Langkah 6.5")
  // ===========================================================================
  // Login MUST go through this Edge Function. It verifies the password
  // server-side and mints a JWT signed with the project's real JWT secret
  // (kept only in the Edge Function's environment, never in this file).
  // Without this, login cannot produce a token that Supabase's RLS
  // (`to authenticated` policies) will actually accept — writes will fail
  // with "permission denied" no matter what schema you run.
  // Format: https://aqxllawmskworpovcofq.supabase.co/functions/v1/auth-login
  AUTH_LOGIN_EDGE_FUNCTION_URL: 'https://aqxllawmskworpovcofq.supabase.co/functions/v1/auth-login',

  // ===========================================================================
  // GROQ EDGE FUNCTION URL
  // ===========================================================================
  // Setelah deploy Edge Function "chat" di Supabase, isi URL-nya di sini.
  // Format: https://aqxllawmskworpovcofq.supabase.co/functions/v1/chat
  // Jika belum di-deploy, biarkan kosong ('') — chat AI akan fallback ke
  // mode client-side (membutuhkan API key di-set di Pengaturan, KURANG AMAN).
  GROQ_EDGE_FUNCTION_URL: '',

  // ===========================================================================
  // GROQ API CONFIG (fallback jika Edge Function belum di-deploy)
  // ===========================================================================
  // Model Groq yang dipakai. Bisa diubah di Pengaturan.
  GROQ_DEFAULT_MODEL: 'llama-3.3-70b-versatile',
  GROQ_API_URL: 'https://api.groq.com/openai/v1/chat/completions',

  // ===========================================================================
  // LOGO & FAVICON
  // ===========================================================================
  LOGO_URL:
    'https://upload.wikimedia.org/wikipedia/commons/9/94/Lambang_Kab_Indragiri_Hulu.png',

  // ===========================================================================
  // PETA CONFIG
  // ===========================================================================
  // Batas area peta (Kabupaten Indragiri Hulu — perkiraan)
  MAP_CENTER: [-0.3, 102.3],
  MAP_ZOOM: 9,
  MAP_BOUNDARY: [
    [0.07, 102.0], [0.05, 102.2], [0.08, 102.4], [0.02, 102.58], [-0.02, 102.75],
    [-0.1, 102.8], [-0.2, 102.78], [-0.3, 102.75], [-0.38, 102.68],
    [-0.42, 102.58], [-0.4, 102.48], [-0.46, 102.4], [-0.53, 102.3],
    [-0.58, 102.15], [-0.55, 102.0], [-0.5, 101.9], [-0.42, 101.75],
    [-0.32, 101.68], [-0.2, 101.68], [-0.1, 101.78], [-0.02, 101.88],
    [0.07, 102.0],
  ],
  MAP_MAX_BOUNDS: [[-0.75, 101.55], [0.25, 102.95]],

  // ===========================================================================
  // SESSION
  // ===========================================================================
  // Sesi disimpan di localStorage agar tetap login setelah refresh browser
  SESSION_KEY: 'peta_kesehatan_session',
  SESSION_MAX_AGE_MS: 24 * 60 * 60 * 1000, // 24 jam (diperbarui dari 7 hari untuk keamanan)
  SESSION_FINGERPRINT_KEY: 'peta_kesehatan_fingerprint',
}
