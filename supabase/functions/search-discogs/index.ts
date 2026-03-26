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

interface SearchPayload {
  record_id: string;
  artist?: string | null;
  title?: string | null;
  label?: string | null;
  catalog_number?: string | null;
  year?: string | null;
}

interface DiscogsResult {
  id: number;
  title: string;
  label?: string[];
  catno?: string;
  year?: number | string;
  country?: string;
  format?: string[];
  thumb?: string;
}

interface DiscogsImage {
  type: string;
  uri: string;
  uri150: string;
  width: number;
  height: number;
}

interface VisualComparison {
  visual_match_score: number;
  same_release_likelihood: string;
  same_pressing_likelihood: string;
  visual_reason: string;
}

async function getDiscogsReleaseImages(
  releaseId: number,
  discogsToken: string
): Promise<string[]> {
  try {
    const res = await fetch(`https://api.discogs.com/releases/${releaseId}`, {
      headers: {
        "Authorization": `Discogs token=${discogsToken}`,
        "User-Agent": "VinylToDiscogs/1.0",
      },
    });
    if (!res.ok) return [];
    const data: { images?: DiscogsImage[] } = await res.json();
    if (!data.images || data.images.length === 0) return [];
    return data.images.slice(0, 3).map((img) => img.uri);
  } catch {
    return [];
  }
}

async function visualCompare(
  uploadedPhotos: { file_url: string; photo_type: string }[],
  discogsImages: string[],
  openaiApiKey: string
): Promise<VisualComparison> {
  const fallback: VisualComparison = {
    visual_match_score: 0,
    same_release_likelihood: "unknown",
    same_pressing_likelihood: "unknown",
    visual_reason: "comparison failed",
  };

  if (discogsImages.length === 0) return fallback;

  try {
    const uploadedImageParts = uploadedPhotos.slice(0, 4).map((p) => ({
      type: "image_url" as const,
      image_url: { url: p.file_url, detail: "low" as const },
    }));

    const discogsImageParts = discogsImages.slice(0, 2).map((url) => ({
      type: "image_url" as const,
      image_url: { url, detail: "low" as const },
    }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          max_tokens: 250,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `You are a vinyl record identification expert. Compare the UPLOADED RECORD photos (first set) against the DISCOGS CANDIDATE artwork (second set).

Evaluate visual similarity across:
- Sleeve/cover artwork design, imagery, and layout
- Label design, color, and logo
- Typography, color palette, layout consistency
- Packaging and format cues
- Any visible text is a secondary visual clue only

Return ONLY valid JSON:
{
  "visual_match_score": 0-100,
  "same_release_likelihood": "very_high" | "high" | "medium" | "low" | "very_low",
  "same_pressing_likelihood": "very_high" | "high" | "medium" | "low" | "very_low",
  "visual_reason": "brief explanation under 25 words"
}

UPLOADED RECORD photos:`,
                },
                ...uploadedImageParts,
                {
                  type: "text",
                  text: "DISCOGS CANDIDATE artwork:",
                },
                ...discogsImageParts,
              ],
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) return fallback;

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? "";
      const clean = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(clean);

      return {
        visual_match_score: Math.min(100, Math.max(0, Math.round(parsed.visual_match_score ?? 0))),
        same_release_likelihood: parsed.same_release_likelihood ?? "unknown",
        same_pressing_likelihood: parsed.same_pressing_likelihood ?? "unknown",
        visual_reason: parsed.visual_reason ?? "",
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return fallback;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    const discogsAppToken = Deno.env.get("DISCOGS_TOKEN");

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
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

    const payload: SearchPayload = await req.json();
    const { record_id, artist, title, label, catalog_number, year } = payload;

    if (!record_id) {
      return new Response(JSON.stringify({ error: "record_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const yearNum = year ? parseInt(year, 10) : null;

    await serviceClient.from("records").update({
      artist: artist ?? null,
      title: title ?? null,
      label: label ?? null,
      catalog_number: catalog_number ?? null,
      year: yearNum && !isNaN(yearNum) ? yearNum : null,
    }).eq("id", record_id).eq("user_id", user.id);

    const { data: userProfile } = await serviceClient
      .from("users")
      .select("discogs_token_encrypted")
      .eq("id", user.id)
      .maybeSingle();

    let discogsToken = discogsAppToken;
    if (userProfile?.discogs_token_encrypted) {
      try {
        discogsToken = await decryptToken(userProfile.discogs_token_encrypted, supabaseServiceKey);
      } catch {
        discogsToken = userProfile.discogs_token_encrypted;
      }
    }

    if (!discogsToken) {
      return new Response(JSON.stringify({ error: "No Discogs token configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const searchParams = new URLSearchParams();
    searchParams.set("type", "release");
    searchParams.set("per_page", "30");
    if (catalog_number) searchParams.set("catno", catalog_number);
    if (artist) searchParams.set("artist", artist);
    if (title) searchParams.set("release_title", title);
    if (label) searchParams.set("label", label);

    let candidates: DiscogsResult[] = [];

    const primaryRes = await fetch(
      `https://api.discogs.com/database/search?${searchParams.toString()}`,
      {
        headers: {
          "Authorization": `Discogs token=${discogsToken}`,
          "User-Agent": "VinylToDiscogs/1.0",
        },
      }
    );

    if (primaryRes.ok) {
      const data = await primaryRes.json();
      candidates = data.results ?? [];
    }

    if (candidates.length < 5 && (artist || title)) {
      const fallbackParams = new URLSearchParams();
      fallbackParams.set("type", "release");
      fallbackParams.set("per_page", "30");
      fallbackParams.set("q", [artist, title].filter(Boolean).join(" "));

      const fallbackRes = await fetch(
        `https://api.discogs.com/database/search?${fallbackParams.toString()}`,
        {
          headers: {
            "Authorization": `Discogs token=${discogsToken}`,
            "User-Agent": "VinylToDiscogs/1.0",
          },
        }
      );

      if (fallbackRes.ok) {
        const data = await fallbackRes.json();
        const existingIds = new Set(candidates.map((c) => c.id));
        const newResults = (data.results ?? []).filter(
          (r: DiscogsResult) => !existingIds.has(r.id)
        );
        candidates = [...candidates, ...newResults];
      }
    }

    const { data: photos } = await serviceClient
      .from("record_photos")
      .select("file_url, photo_type")
      .eq("record_id", record_id);

    const uploadedPhotos = photos ?? [];
    const topCandidates = candidates.slice(0, 8);

    interface ScoredCandidate {
      result: DiscogsResult;
      visual_match_score: number;
      same_release_likelihood: string;
      same_pressing_likelihood: string;
      visual_reason: string;
    }

    let scored: ScoredCandidate[] = [];

    if (openaiApiKey && uploadedPhotos.length > 0 && topCandidates.length > 0) {
      const BATCH_SIZE = 4;
      const allResults: ScoredCandidate[] = [];

      for (let i = 0; i < topCandidates.length; i += BATCH_SIZE) {
        const batch = topCandidates.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (candidate) => {
            const images = await getDiscogsReleaseImages(candidate.id, discogsToken!);
            const comparison = await visualCompare(uploadedPhotos, images, openaiApiKey);
            return {
              result: candidate,
              visual_match_score: comparison.visual_match_score,
              same_release_likelihood: comparison.same_release_likelihood,
              same_pressing_likelihood: comparison.same_pressing_likelihood,
              visual_reason: comparison.visual_reason,
            };
          })
        );
        allResults.push(...batchResults);
      }

      scored = allResults
        .sort((a, b) => b.visual_match_score - a.visual_match_score)
        .slice(0, 10);
    } else {
      scored = topCandidates.slice(0, 10).map((result) => ({
        result,
        visual_match_score: 0,
        same_release_likelihood: "unknown",
        same_pressing_likelihood: "unknown",
        visual_reason: "visual comparison unavailable",
      }));
    }

    await serviceClient.from("discogs_candidates").delete().eq("record_id", record_id);

    if (scored.length > 0) {
      const inserts = scored.map(({ result, visual_match_score, same_release_likelihood, same_pressing_likelihood, visual_reason }) => ({
        record_id,
        discogs_release_id: String(result.id),
        title: result.title ?? null,
        label: (result.label ?? [])[0] ?? null,
        catno: result.catno ?? null,
        year: result.year ? parseInt(String(result.year)) : null,
        country: result.country ?? null,
        format: (result.format ?? [])[0] ?? null,
        thumb_url: result.thumb ?? null,
        score: visual_match_score,
        visual_score: visual_match_score,
        same_release_likelihood,
        same_pressing_likelihood,
        visual_reason,
        reasons_json: [
          visual_match_score >= 70 ? "strong visual match" : visual_match_score >= 40 ? "partial visual match" : "weak visual match",
          same_release_likelihood === "very_high" || same_release_likelihood === "high" ? "release likely" : null,
          same_pressing_likelihood === "very_high" || same_pressing_likelihood === "high" ? "pressing likely" : null,
        ].filter(Boolean),
        is_selected: false,
      }));

      await serviceClient.from("discogs_candidates").insert(inserts);
    }

    const topScore = scored[0]?.visual_match_score ?? 0;
    const newStatus = scored.length > 0 && topScore >= 30 ? "matched" : "needs_review";

    await serviceClient.from("records").update({
      status: newStatus,
      confidence: topScore,
      error_message: scored.length === 0
        ? "No matching releases found with updated metadata."
        : null,
    }).eq("id", record_id);

    return new Response(
      JSON.stringify({
        success: true,
        status: newStatus,
        candidates_found: scored.length,
        top_visual_score: topScore,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("search-discogs error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
