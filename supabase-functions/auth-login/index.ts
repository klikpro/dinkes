// ===========================================================================
// Supabase Edge Function: auth-login — SECURITY CRITICAL
// ===========================================================================
// WHY THIS FUNCTION EXISTS (read before removing it):
//
// The previous version of this app created a "custom JWT" entirely in the
// browser (js/auth.js -> createSimpleJWT) and signed it with HMAC-SHA256
// using CONFIG.SUPABASE_ANON_KEY as the secret. The anon key is PUBLIC by
// design (it ships in every page load) — so that JWT could be forged by
// ANYONE who opened DevTools, with any user_id/role they wanted, including
// role: 'super_admin'. Combined with RLS policies that trust
// auth.jwt() -> user_metadata ->> 'role', this meant any visitor could
// grant themselves super_admin and read/write every table.
//
// On top of that, js/supabase.js deliberately never sent that token as an
// Authorization header (setSupabaseAuth() was a no-op), because Supabase's
// PostgREST would reject a JWT not signed with the REAL project JWT secret.
// That means every request was actually executed as the `anon` role, and
// since schema_secure.sql restricts writes to `authenticated`, the
// dashboard could never actually write anything — the "hardened" schema
// silently broke the app.
//
// This Edge Function fixes both problems at once:
// 1. Credentials are verified server-side via the existing verify_login()
//    RPC (bcrypt compare + rate limiting), using the SERVICE ROLE key which
//    never reaches the browser.
// 2. A real Supabase-compatible JWT is minted and signed with
//    SUPABASE_JWT_SECRET, an Edge Function secret that is NEVER exposed to
//    the client. Because the signature is genuine, PostgREST accepts it,
//    auth.jwt() resolves correctly, and the `to authenticated` RLS
//    policies (current_user_role() / current_user_id()) work as designed.
//
// DEPLOY:
//   supabase functions deploy auth-login --no-verify-jwt
//   supabase secrets set SUPABASE_JWT_SECRET=<your project's JWT secret>
//     (Dashboard → Project Settings → Data API → JWT Settings → "Legacy JWT secret")
//   Edit ALLOWED_ORIGINS below, then edit js/config.js -> AUTH_LOGIN_EDGE_FUNCTION_URL
//
// NOTE: Newer Supabase projects can be configured to use asymmetric
// (ECC/RSA) signing keys instead of a shared HS256 secret. If your project
// only has an asymmetric signing key and no "legacy" HS256 secret, this
// approach cannot mint a JWT compatible with the built-in RLS
// auth.jwt() helpers — in that case, migrate to real Supabase Auth
// (supabase.auth.signInWithPassword + a `profiles` table) instead of the
// bespoke `users` table used here.
// ===========================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://peta-kesehatan-inhu.vercel.app", // REPLACE with your actual domain
  "https://peta-kesehatan-inhu.netlify.app", // REPLACE with your actual domain
  "http://localhost:8080", // development only
  "http://localhost:3000", // development only
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Simple in-memory per-IP rate limiter as defense-in-depth on top of the
// database-backed rate limit already enforced inside verify_login().
const rateLimitMap = new Map<string, { count: number; lastReset: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.lastReset > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, lastReset: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const enc = new TextEncoder();
  const encHeader = b64url(enc.encode(JSON.stringify(header)));
  const encPayload = b64url(enc.encode(JSON.stringify(payload)));
  const signingInput = `${encHeader}.${encPayload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
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

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(corsHeaders, 405, "Method not allowed");

  try {
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";
    if (!checkRateLimit(clientIp)) {
      return jsonError(corsHeaders, 429, "Terlalu banyak percobaan. Coba lagi dalam 1 menit.");
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonError(corsHeaders, 400, "Format email tidak valid.");
    }
    if (!password || password.length < 8) {
      return jsonError(corsHeaders, 400, "Password minimal 8 karakter.");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const jwtSecret = Deno.env.get("JWT_SECRET");
    if (!supabaseUrl || !serviceRoleKey || !jwtSecret) {
      console.error("auth-login misconfigured: missing env vars");
      return jsonError(corsHeaders, 500, "Server misconfigured.");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // verify_login() already enforces the 5-attempts/15-minute lockout and
    // uses bcrypt (pgcrypto) to compare the password hash.
    const { data, error } = await supabase.rpc("verify_login", {
      p_email: email,
      p_password: password,
    });

    if (error) {
      // Surface only the safe, known messages raised by verify_login()
      const msg = error.message || "";
      if (msg.includes("Terlalu banyak percobaan")) {
        return jsonError(corsHeaders, 429, msg);
      }
      console.error("verify_login error", error);
      return jsonError(corsHeaders, 500, "Terjadi kesalahan. Silakan coba lagi.");
    }

    if (!data || data.length === 0) {
      return jsonError(corsHeaders, 401, "Email atau password salah");
    }

    const user = data[0];
    if (!user.is_active) {
      return jsonError(corsHeaders, 403, "Akun Anda dinonaktifkan. Hubungi Super Admin.");
    }

    const now = Math.floor(Date.now() / 1000);
    const sessionMaxAgeSec = 24 * 3600; // 24 hours, matches CONFIG.SESSION_MAX_AGE_MS
    const jwtPayload = {
      iss: `${supabaseUrl}/auth/v1`,
      sub: user.id,
      aud: "authenticated",
      role: "authenticated",
      iat: now,
      exp: now + sessionMaxAgeSec,
      email: user.email,
      user_metadata: {
        user_id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      app_metadata: {
        role: user.role,
        user_id: user.id,
      },
    };

    const token = await signJwt(jwtPayload, jwtSecret);

    return jsonResponse(corsHeaders, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        is_active: user.is_active,
        password_changed_at: user.password_changed_at,
      },
      token,
      expiresInSeconds: sessionMaxAgeSec,
    });
  } catch (e) {
    console.error("auth-login function error", e);
    return jsonError(corsHeaders, 500, "Terjadi kesalahan internal. Silakan coba lagi.");
  }
});
