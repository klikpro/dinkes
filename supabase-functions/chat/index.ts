// ===========================================================================
// Supabase Edge Function: chat — SECURITY-HARDENED VERSION
// ===========================================================================
// SECURITY IMPROVEMENTS (vs original):
// - CORS restricted to specific origins (not wildcard *)
// - Input validation: max 500 chars for message
// - Input sanitization: strip HTML tags from message
// - Rate limiting: simple per-IP counter (in-memory, resets on deploy)
// - Error messages sanitized (no internal details exposed)
// - Mode validation: only 'public' or 'dashboard' allowed
// ===========================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===========================================================================
// CORS — Restricted to specific origins (REPLACE with your deployment domain)
// ===========================================================================
const ALLOWED_ORIGINS = [
  "https://peta-kesehatan-inhu.vercel.app",     // REPLACE with your actual domain
  "https://peta-kesehatan-inhu.netlify.app",    // REPLACE with your actual domain
  "http://localhost:8080",                       // development only
  "http://localhost:3000",                       // development only
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0]; // fallback to primary domain

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin", // important for caching with dynamic CORS
  };
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// ===========================================================================
// SIMPLE IN-MEMORY RATE LIMITER (per IP, resets on function cold start)
// ===========================================================================
const rateLimitMap = new Map<string, { count: number; lastReset: number }>();
const RATE_LIMIT_MAX = 20;         // max requests per IP per window
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute window

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.lastReset > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, lastReset: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false; // rate limited
  }
  entry.count++;
  return true;
}

// ===========================================================================
// INPUT SANITIZATION
// ===========================================================================
function sanitizeInput(str: string): string {
  // Strip HTML tags
  return str.replace(/<[^>]*>/g, "").trim();
}

function safeErrorMessage(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err)) || "";
  // Only return known user-facing errors, hide internals
  if (msg.includes("belum dikonfigurasi")) return msg;
  if (msg.includes("Pesan tidak boleh kosong")) return msg;
  if (msg.includes("Terlalu banyak")) return msg;
  if (msg.includes("Pesan terlalu panjang")) return msg;
  if (msg.includes("Mode tidak valid")) return msg;
  // Don't expose internal errors to client
  return "Terjadi kesalahan internal. Silakan coba lagi.";
}

// ===========================================================================
// MAIN HANDLER
// ===========================================================================
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Rate limit check
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("cf-connecting-ip")
      || "unknown";
    if (!checkRateLimit(clientIp)) {
      return jsonError(corsHeaders, 429, "Terlalu banyak permintaan. Coba lagi dalam 1 menit.");
    }

    const body = await req.json();
    const { message, mode } = body;

    // Validate message
    if (!message || !message.trim()) {
      return jsonError(corsHeaders, 400, "Pesan tidak boleh kosong");
    }

    // Sanitize and limit message length
    const sanitizedMessage = sanitizeInput(message);
    if (sanitizedMessage.length > 500) {
      return jsonError(corsHeaders, 400, "Pesan terlalu panjang (maksimal 500 karakter).");
    }
    if (!sanitizedMessage) {
      return jsonError(corsHeaders, 400, "Pesan tidak boleh kosong setelah sanitasi.");
    }

    // Validate mode
    const validMode = mode === "public" || mode === "dashboard" ? mode : "public";

    // Create Supabase client with service role key (server-side only)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonError(corsHeaders, 500, "Server misconfigured");
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
        corsHeaders,
        400,
        "API Key Groq belum dikonfigurasi. Super Admin dapat mengaturnya di menu Pengaturan."
      );
    }
    const model = modelData?.value || "llama-3.3-70b-versatile";

    // Build database context
    const context = await buildContext(supabase, validMode);

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
          { role: "user", content: sanitizedMessage },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });

    if (!groqResp.ok) {
      console.error("Groq API error", groqResp.status);
      return jsonError(corsHeaders, 502, "Gagal menghubungi AI service. Periksa konfigurasi.");
    }

    const data = await groqResp.json();
    const answer =
      data?.choices?.[0]?.message?.content ||
      "Maaf, saya tidak dapat memberikan jawaban saat ini.";

    return jsonResponse(corsHeaders, { answer });
  } catch (e) {
    console.error("chat function error", e);
    return jsonError(corsHeaders, 500, safeErrorMessage(e));
  }
});

async function buildContext(supabase, mode: string) {
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
      .select("*, subcategory:subcategories!inner(*, category:categories!inner(*))")
      .eq("subcategory.is_active", true)
      .eq("subcategory.category.is_active", true)
      .order("updated_at", { ascending: false }),
  ]);

  const districtList = districts.data || [];
  const subcatList = subcategories.data || [];
  const caseList = cases.data || [];

  const totals: Record<string, number> = {};
  caseList.forEach((c) => {
    totals[c.subcategory.name] = (totals[c.subcategory.name] || 0) + c.value;
  });

  const byDistrict: Record<string, Record<string, number>> = {};
  caseList.forEach((c) => {
    if (!byDistrict[c.district_id]) byDistrict[c.district_id] = {};
    byDistrict[c.district_id][c.subcategory.name] = c.value;
  });

  const lines: string[] = [];
  lines.push("DATA KESEHATAN KABUPATEN INDRAGIRI HULU (ringkasan):");
  lines.push(`- Jumlah kecamatan: ${districtList.length}`);
  lines.push(`- Jumlah kategori aktif: ${new Set(subcatList.map((s) => s.category.id)).size}`);
  lines.push("");
  lines.push("KATEGORI & SUBKATEGORI:");
  const byCat: Record<string, any[]> = {};
  subcatList.forEach((s) => {
    if (!byCat[s.category.name]) byCat[s.category.name] = [];
    byCat[s.category.name].push(s);
  });
  Object.entries(byCat).forEach(([catName, subs]) => {
    lines.push(`• ${catName}: ${subs.map((s) => s.name + (s.unit ? ` (${s.unit})` : "")).join(", ")}`);
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

function jsonResponse(corsHeaders: Record<string, string>, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(corsHeaders: Record<string, string>, status: number, message: string) {
  return jsonResponse(corsHeaders, { error: message }, status);
}
