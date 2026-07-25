// ===========================================================================
// Supabase Edge Function: chat
// ===========================================================================
// Fungsi: Menerima pertanyaan dari client, memanggil Groq API dengan konteks
// dari database Supabase, mengembalikan jawaban.
//
// CARA DEPLOY:
// 1. Install Supabase CLI: https://supabase.com/docs/guides/cli
// 2. Login: supabase login
// 3. Link project: supabase link --project-ref aqxllawmskworpovcofq
// 4. Set Groq API key di settings (jalankan di dashboard → Pengaturan)
// 5. Deploy function:
//    supabase functions deploy chat --no-verify-jwt
// 6. Setelah deploy, URL function adalah:
//    https://aqxllawmskworpovcofq.supabase.co/functions/v1/chat
// 7. Salin URL tersebut ke file js/config.js:
//    GROQ_EDGE_FUNCTION_URL: 'https://aqxllawmskworpovcofq.supabase.co/functions/v1/chat'
//
// Catatan keamanan:
// - Function ini menggunakan SERVICE_ROLE_KEY (server-side), bukan anon key
// - API key Groq diambil dari tabel settings (di-set via dashboard)
// - API key Groq TIDAK PERNAH diekspos ke client
// ===========================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { message, mode } = await req.json();
    if (!message || !message.trim()) {
      return jsonError(400, "Pesan tidak boleh kosong");
    }

    // Create Supabase client with service role key (server-side only)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonError(500, "Server misconfigured: missing env vars");
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Get Groq API key + model from settings
    const [{ data: apiKeyData }, { data: modelData }] = await Promise.all([
      supabase.from("settings").select("value").eq("key", "groq_api_key").single(),
      supabase.from("settings").select("value").eq("key", "groq_model").single(),
    ]);
    const apiKey = apiKeyData?.value;
    if (!apiKey) {
      return jsonError(
        400,
        "API Key Groq belum dikonfigurasi. Super Admin dapat mengaturnya di menu Pengaturan."
      );
    }
    const model = modelData?.value || "llama-3.3-70b-versatile";

    // Build database context
    const context = await buildContext(supabase, mode, req);

    const systemPrompt = `Anda adalah asisten AI Dinas Kesehatan Kabupaten Indragiri Hulu.

Tugas Anda:
- Menjawab pertanyaan pengguna BERDASARKAN DATA yang diberikan di bawah ini.
- Selalu merujuk pada data terbaru yang ada di database.
- Jika ditanya tentang kecamatan tertentu, sebutkan angka spesifik dari data.
- Jika data tidak tersedia untuk pertanyaan tersebut, katakan dengan jujur.
- Gunakan bahasa Indonesia formal pemerintahan.
- Jawab ringkas, jelas, dan padat (maksimal 4 paragraf).
- Jangan mengarang angka yang tidak ada di data.

${context}`;

    // Call Groq API
    const groqResp = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });

    if (!groqResp.ok) {
      const errText = await groqResp.text();
      console.error("Groq API error", groqResp.status, errText);
      return jsonError(
        502,
        `Groq API error (${groqResp.status}). Periksa API key dan model di Pengaturan.`
      );
    }

    const data = await groqResp.json();
    const answer =
      data?.choices?.[0]?.message?.content ||
      "Maaf, saya tidak dapat memberikan jawaban saat ini.";

    // Optional: save to chat_history (skip if anonymous)
    // We don't have reliable user identification here without proper auth,
    // so we skip saving. The client can save it via the API after receiving answer.

    return jsonResponse({ answer });
  } catch (e) {
    console.error("chat function error", e);
    return jsonError(500, e.message || "Internal server error");
  }
});

async function buildContext(supabase, mode, req) {
  const [districts, subcategories, cases] = await Promise.all([
    supabase.from("districts").select("*").order("name"),
    supabase
      .from("subcategories")
      .select("*, category:categories(*)")
      .eq("is_active", true)
      .eq("category.is_active", true)
      .order("sort_order"),
    supabase
      .from("case_records")
      .select(
        "*, subcategory:subcategories!inner(*, category:categories!inner(*))"
      )
      .eq("subcategory.is_active", true)
      .eq("subcategory.category.is_active", true)
      .order("updated_at", { ascending: false }),
  ]);

  const districtList = districts.data || [];
  const subcatList = subcategories.data || [];
  const caseList = cases.data || [];

  // Aggregate totals per subcategory
  const totals = {};
  caseList.forEach((c) => {
    totals[c.subcategory.name] = (totals[c.subcategory.name] || 0) + c.value;
  });

  // Aggregate per district
  const byDistrict = {};
  caseList.forEach((c) => {
    if (!byDistrict[c.district_id]) byDistrict[c.district_id] = {};
    byDistrict[c.district_id][c.subcategory.name] = c.value;
  });

  const lines = [];
  lines.push("DATA KESEHATAN KABUPATEN INDRAGIRI HULU (ringkasan):");
  lines.push(`- Jumlah kecamatan: ${districtList.length}`);
  lines.push(`- Jumlah kategori aktif: ${new Set(subcatList.map((s) => s.category.id)).size}`);
  lines.push("");
  lines.push("KATEGORI & SUBKATEGORI:");
  const byCat = {};
  subcatList.forEach((s) => {
    if (!byCat[s.category.name]) byCat[s.category.name] = [];
    byCat[s.category.name].push(s);
  });
  Object.entries(byCat).forEach(([catName, subs]) => {
    lines.push(
      `• ${catName}: ${subs.map((s) => s.name + (s.unit ? ` (${s.unit})` : "")).join(", ")}`
    );
  });
  lines.push("");
  lines.push("TOTAL PER SUBKATEGORI (seluruh kabupaten):");
  Object.entries(totals).forEach(([sub, total]) => {
    lines.push(`• ${sub}: ${total}`);
  });
  lines.push("");
  lines.push("DATA PER KECAMATAN:");
  districtList.forEach((d) => {
    const vals = byDistrict[d.id];
    if (!vals || Object.keys(vals).length === 0) {
      lines.push(`• ${d.name}: (belum ada data)`);
    } else {
      const parts = Object.entries(vals).map(([k, v]) => `${k}=${v}`);
      lines.push(`• ${d.name}: ${parts.join(", ")}`);
    }
  });

  return lines.join("\n");
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(status, message) {
  return jsonResponse({ error: message }, status);
}
