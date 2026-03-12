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
  resource_url?: string;
}

interface DiscogsImage {
  type: string;
  uri: string;
  uri150: string;
  width: number;
  height: number;
}

function scoreCandidate(
  result: DiscogsResult,
  artist: string | null,
  title: string | null,
  label: string | null,
  catalog_number: string | null,
  year: number | null
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const normalize = (s: string | null | undefined) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const catnoNorm = normalize(catalog_number);
  const labelNorm = normalize(label);
  const resultCatno = normalize(result.catno);
  const resultLabel = normalize((result.label ?? [])[0]);

  const [artistPart, titlePart] = result.title.includes(" - ")
    ? result.title.split(" - ", 2)
    : [result.title, ""];

  const artistNorm = normalize(artist);
  const titleNorm = normalize(title);

  if (catnoNorm && resultCatno && catnoNorm === resultCatno) {
    score += 50;
    reasons.push("catalog match");
  } else if (catnoNorm && resultCatno && resultCatno.includes(catnoNorm)) {
    score += 25;
    reasons.push("partial catalog");
  }

  if (labelNorm && resultLabel && resultLabel.includes(labelNorm)) {
    score += 20;
    reasons.push("label match");
  }

  if (artistNorm && normalize(artistPart).includes(artistNorm)) {
    score += 15;
    reasons.push("artist match");
  } else if (artistNorm && artistNorm.includes(normalize(artistPart))) {
    score += 8;
    reasons.push("partial artist");
  }

  if (titleNorm && normalize(titlePart).includes(titleNorm)) {
    score += 15;
    reasons.push("title match");
  } else if (titleNorm && titleNorm.includes(normalize(titlePart))) {
    score += 8;
    reasons.push("partial title");
  }

  if (year && result.year) {
    const resultYear = typeof result.year === "string" ? parseInt(result.year) : result.year;
    if (resultYear === year) {
      score += 5;
      reasons.push("year match");
    }
  }

  return { score, reasons };
}

async function getDiscogsReleaseImage(
  releaseId: number,
  discogsToken: string
): Promise<string | null> {
  try {
    const res = await fetch(`https://api.discogs.com/releases/${releaseId}`, {
      headers: {
        "Authorization": `Discogs token=${discogsToken}`,
        "User-Agent": "VinylToDiscogs/1.0",
      },
    });
    if (!res.ok) return null;
    const data: { images?: DiscogsImage[] } = await res.json();
    const primary = data.images?.find((img) => img.type === "primary") ?? data.images?.[0];
    return primary?.uri ?? null;
  } catch {
    return null;
  }
}

async function getVisualScore(
  uploadedImageUrl: string,
  discogsImageUrl: string,
  openaiApiKey: string
): Promise<{ visual_score: number; visual_reason: string }> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are comparing vinyl record artwork.

Image A: uploaded record cover or label
Image B: Discogs release artwork

Evaluate whether these represent the same release.

Return ONLY valid JSON with no markdown:
{
  "visual_match_score": number from 0 to 100,
  "reason": "short explanation under 20 words"
}`,
              },
              { type: "image_url", image_url: { url: uploadedImageUrl, detail: "low" } },
              { type: "image_url", image_url: { url: discogsImageUrl, detail: "low" } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) return { visual_score: 0, visual_reason: "vision api error" };

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const clean = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    return {
      visual_score: Math.min(100, Math.max(0, Math.round(parsed.visual_match_score ?? 0))),
      visual_reason: parsed.reason ?? "",
    };
  } catch {
    return { visual_score: 0, visual_reason: "comparison failed" };
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
    searchParams.set("per_page", "25");
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

    if (candidates.length === 0 && (artist || title)) {
      const fallbackParams = new URLSearchParams();
      fallbackParams.set("type", "release");
      fallbackParams.set("per_page", "25");
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
        candidates = data.results ?? [];
      }
    }

    const textScored = candidates
      .map((result) => {
        const { score, reasons } = scoreCandidate(
          result, artist ?? null, title ?? null, label ?? null,
          catalog_number ?? null, yearNum
        );
        return { result, score, reasons };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const { data: photos } = await serviceClient
      .from("record_photos")
      .select("file_url, photo_type")
      .eq("record_id", record_id);

    const uploadedPhotoUrl = photos?.find((p) => p.photo_type === "cover_front")?.file_url
      ?? photos?.[0]?.file_url ?? null;

    const top5 = textScored.slice(0, 5);
    const rest = textScored.slice(5);

    interface VisualResult {
      result: DiscogsResult;
      score: number;
      reasons: string[];
      visual_score: number | null;
      visual_reason: string | null;
    }

    let visuallyScored: VisualResult[] = [];

    if (openaiApiKey && uploadedPhotoUrl && top5.length > 0) {
      const visualResults = await Promise.all(
        top5.map(async ({ result, score, reasons }) => {
          const releaseImageUrl = await getDiscogsReleaseImage(result.id, discogsToken);
          if (!releaseImageUrl) {
            return { result, score, reasons, visual_score: null, visual_reason: null };
          }
          const { visual_score, visual_reason } = await getVisualScore(
            uploadedPhotoUrl, releaseImageUrl, openaiApiKey
          );
          const visualBonus = Math.round((visual_score / 100) * 30);
          return {
            result,
            score: score + visualBonus,
            reasons: visual_score >= 60 ? [...reasons, `visual ${visual_score}%`] : reasons,
            visual_score,
            visual_reason,
          };
        })
      );
      visuallyScored = [
        ...visualResults.sort((a, b) => b.score - a.score),
        ...rest.map(({ result, score, reasons }) => ({
          result, score, reasons, visual_score: null, visual_reason: null,
        })),
      ];
    } else {
      visuallyScored = textScored.map(({ result, score, reasons }) => ({
        result, score, reasons, visual_score: null, visual_reason: null,
      }));
    }

    await serviceClient.from("discogs_candidates").delete().eq("record_id", record_id);

    if (visuallyScored.length > 0) {
      const inserts = visuallyScored.map(({ result, score, reasons, visual_score, visual_reason }) => ({
        record_id,
        discogs_release_id: String(result.id),
        title: result.title ?? null,
        label: (result.label ?? [])[0] ?? null,
        catno: result.catno ?? null,
        year: result.year ? parseInt(String(result.year)) : null,
        country: result.country ?? null,
        format: (result.format ?? [])[0] ?? null,
        score,
        reasons_json: reasons,
        visual_score,
        visual_reason,
        is_selected: false,
      }));

      await serviceClient.from("discogs_candidates").insert(inserts);
    }

    const newStatus = visuallyScored.length > 0 ? "matched" : "needs_review";
    await serviceClient.from("records").update({
      status: newStatus,
      error_message: visuallyScored.length === 0
        ? "No matching releases found with updated metadata."
        : null,
    }).eq("id", record_id);

    return new Response(
      JSON.stringify({
        success: true,
        status: newStatus,
        candidates_found: visuallyScored.length,
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
