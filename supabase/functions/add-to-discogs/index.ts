import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALGORITHM = "AES-GCM";

async function deriveKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode("discogs-token-encryption"), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: ALGORITHM, length: 256 },
    false,
    ["decrypt"]
  );
}

async function decryptToken(ciphertext: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const raw = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const data = raw.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { record_id, release_id } = await req.json();
    if (!record_id || !release_id) {
      return new Response(JSON.stringify({ error: "record_id and release_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userProfile, error: profileError } = await supabase
      .from("users")
      .select("discogs_token_encrypted, discogs_username")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !userProfile?.discogs_token_encrypted || !userProfile?.discogs_username) {
      return new Response(
        JSON.stringify({ error: "Discogs account not connected. Add your token in Settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let discogsToken = userProfile.discogs_token_encrypted;
    try {
      discogsToken = await decryptToken(discogsToken, supabaseServiceKey);
    } catch {
      // fallback to raw value for backwards compatibility
    }
    const discogsUsername = userProfile.discogs_username;

    const discogsRes = await fetch(
      `https://api.discogs.com/users/${discogsUsername}/collection/folders/0/releases/${release_id}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Discogs token=${discogsToken}`,
          "User-Agent": "VinylToDiscogs/1.0",
          "Content-Type": "application/json",
        },
      }
    );

    if (!discogsRes.ok) {
      const errText = await discogsRes.text();
      let errMsg = `Discogs API error (${discogsRes.status})`;
      if (discogsRes.status === 401) errMsg = "Invalid Discogs token. Update it in Settings.";
      else if (discogsRes.status === 404) errMsg = "Release not found on Discogs.";
      else if (discogsRes.status === 409) errMsg = "This release is already in your collection.";

      await supabase.from("records").update({
        status: "failed",
        error_message: errMsg,
      }).eq("id", record_id);

      return new Response(JSON.stringify({ error: errMsg, detail: errText }), {
        status: discogsRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const discogsData = await discogsRes.json();

    await supabase.from("discogs_candidates")
      .update({ is_selected: false })
      .eq("record_id", record_id);

    await supabase.from("discogs_candidates")
      .update({ is_selected: true })
      .eq("record_id", record_id)
      .eq("discogs_release_id", String(release_id));

    await supabase.from("records").update({
      status: "added",
      selected_release_id: String(release_id),
      error_message: null,
    }).eq("id", record_id);

    return new Response(
      JSON.stringify({ success: true, instance_id: discogsData.instance_id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("add-to-discogs error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
