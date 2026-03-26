import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
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
    {
      name: "PBKDF2",
      salt: encoder.encode("discogs-token-encryption"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: ALGORITHM, length: 256 },
    false,
    ["decrypt"]
  );
}

async function decryptToken(
  ciphertext: string,
  secret: string
): Promise<string> {
  const key = await deriveKey(secret);
  const raw = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const data = raw.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    data
  );
  return new TextDecoder().decode(decrypted);
}

interface QuickMeta {
  artist: string | null;
  title: string | null;
  label: string | null;
  catalog_number: string | null;
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

function errorResponse(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function failRecord(
  supabase: ReturnType<typeof createClient>,
  recordId: string,
  errorMessage: string
) {
  console.error(
    `[process-record] FAILED record=${recordId}: ${errorMessage}`
  );
  const { error } = await supabase
    .from("records")
    .update({
      status: "failed",
      error_message: errorMessage,
      processing_step: null,
    })
    .eq("id", recordId);
  if (error) {
    console.error(
      `[process-record] CRITICAL: failRecord could not write to DB record=${recordId}: ${error.message}`
    );
  }
}

async function quickExtractMeta(
  photos: { file_url: string; photo_type: string }[],
  openaiApiKey: string
): Promise<QuickMeta> {
  const imageContents = photos.slice(0, 4).map((photo) => ({
    type: "image_url" as const,
    image_url: { url: photo.file_url, detail: "low" as const },
  }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Look at these vinyl record photos. Extract just enough to search Discogs. Return ONLY valid JSON:
{"artist":"name or null","title":"album title or null","label":"record label or null","catalog_number":"catalog number or null"}`,
              },
              ...imageContents,
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) return { artist: null, title: null, label: null, catalog_number: null };

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const clean = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    return {
      artist: parsed.artist ?? null,
      title: parsed.title ?? null,
      label: parsed.label ?? null,
      catalog_number: parsed.catalog_number ?? null,
    };
  } catch {
    return { artist: null, title: null, label: null, catalog_number: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function getDiscogsReleaseImages(
  releaseId: number,
  discogsToken: string
): Promise<string[]> {
  try {
    const res = await fetch(`https://api.discogs.com/releases/${releaseId}`, {
      headers: {
        Authorization: `Discogs token=${discogsToken}`,
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
          Authorization: `Bearer ${openaiApiKey}`,
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  const discogsAppToken = Deno.env.get("DISCOGS_TOKEN");
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let recordId: string | undefined;

  try {
    const body = await req.json();
    recordId = body.record_id;
  } catch (err) {
    console.error("[process-record] Failed to parse request body:", err);
    return errorResponse("Invalid request body", 400);
  }

  if (!recordId) {
    return errorResponse("record_id is required", 400);
  }

  console.log(`[process-record] START record=${recordId}`);

  {
    const { error } = await supabase
      .from("records")
      .update({ status: "processing", processing_step: "analyzing" })
      .eq("id", recordId);
    if (error) {
      const msg = `Failed to set processing status: ${error.message}`;
      await failRecord(supabase, recordId, msg);
      return errorResponse(msg);
    }
  }

  let photos: { file_url: string; photo_type: string }[];
  try {
    const { data, error } = await supabase
      .from("record_photos")
      .select("*")
      .eq("record_id", recordId);

    if (error) throw new Error(`record_photos query failed: ${error.message}`);
    if (!data || data.length === 0)
      throw new Error("No photos found for this record");
    photos = data;
    console.log(`[process-record] Fetched ${photos.length} photos`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRecord(supabase, recordId, msg);
    return errorResponse(msg, 400);
  }

  let userDiscogsToken = discogsAppToken;
  try {
    const { data: record } = await supabase
      .from("records")
      .select("user_id")
      .eq("id", recordId)
      .maybeSingle();

    if (record?.user_id) {
      const { data: userProfile } = await supabase
        .from("users")
        .select("discogs_token_encrypted")
        .eq("id", record.user_id)
        .maybeSingle();

      if (userProfile?.discogs_token_encrypted) {
        try {
          userDiscogsToken = await decryptToken(
            userProfile.discogs_token_encrypted,
            supabaseServiceKey
          );
        } catch {
          userDiscogsToken = userProfile.discogs_token_encrypted;
        }
      }
    }
  } catch (err) {
    console.error(`[process-record] Error fetching discogs token: ${err}`);
  }

  let quickMeta: QuickMeta = { artist: null, title: null, label: null, catalog_number: null };
  if (openaiApiKey) {
    console.log(`[process-record] Quick meta extraction for search seeding`);
    quickMeta = await quickExtractMeta(photos, openaiApiKey);
    console.log(`[process-record] Quick meta: ${JSON.stringify(quickMeta)}`);
  }

  {
    const { error } = await supabase
      .from("records")
      .update({
        artist: quickMeta.artist,
        title: quickMeta.title,
        label: quickMeta.label,
        catalog_number: quickMeta.catalog_number,
        processing_step: "searching",
      })
      .eq("id", recordId);
    if (error) {
      console.error(`[process-record] Failed to save quick meta: ${error.message}`);
    }
  }

  console.log(`[process-record] Starting Discogs search`);
  let candidates: DiscogsResult[] = [];
  try {
    if (userDiscogsToken) {
      const searchParams = new URLSearchParams();
      searchParams.set("type", "release");
      searchParams.set("per_page", "30");
      if (quickMeta.catalog_number) searchParams.set("catno", quickMeta.catalog_number);
      if (quickMeta.artist) searchParams.set("artist", quickMeta.artist);
      if (quickMeta.title) searchParams.set("release_title", quickMeta.title);
      if (quickMeta.label) searchParams.set("label", quickMeta.label);

      const discogsRes = await fetch(
        `https://api.discogs.com/database/search?${searchParams.toString()}`,
        {
          headers: {
            Authorization: `Discogs token=${userDiscogsToken}`,
            "User-Agent": "VinylToDiscogs/1.0",
          },
        }
      );

      if (discogsRes.ok) {
        const discogsData = await discogsRes.json();
        candidates = discogsData.results ?? [];
      }

      const searchTerms: string[] = [];
      if (quickMeta.artist) searchTerms.push(quickMeta.artist);
      if (quickMeta.title) searchTerms.push(quickMeta.title);

      if (candidates.length < 5 && searchTerms.length > 0) {
        const fallbackParams = new URLSearchParams();
        fallbackParams.set("type", "release");
        fallbackParams.set("per_page", "30");
        fallbackParams.set("q", searchTerms.join(" "));

        const fallbackRes = await fetch(
          `https://api.discogs.com/database/search?${fallbackParams.toString()}`,
          {
            headers: {
              Authorization: `Discogs token=${userDiscogsToken}`,
              "User-Agent": "VinylToDiscogs/1.0",
            },
          }
        );

        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          const existingIds = new Set(candidates.map((c) => c.id));
          const newResults = (fallbackData.results ?? []).filter(
            (r: DiscogsResult) => !existingIds.has(r.id)
          );
          candidates = [...candidates, ...newResults];
        }
      }
    }
    console.log(`[process-record] Discogs candidates=${candidates.length}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRecord(supabase, recordId, `Discogs search failed: ${msg}`);
    return errorResponse(`Discogs search failed: ${msg}`);
  }

  {
    const { error } = await supabase
      .from("records")
      .update({ processing_step: "comparing" })
      .eq("id", recordId);
    if (error) {
      console.error(`[process-record] Failed to update step: ${error.message}`);
    }
  }

  const topCandidates = candidates.slice(0, 8);
  console.log(`[process-record] Visual comparison for ${topCandidates.length} candidates`);

  interface ScoredCandidate {
    result: DiscogsResult;
    visual_match_score: number;
    same_release_likelihood: string;
    same_pressing_likelihood: string;
    visual_reason: string;
    discogsImageUrl: string | null;
  }

  let scored: ScoredCandidate[] = [];

  try {
    if (openaiApiKey && userDiscogsToken && topCandidates.length > 0) {
      const BATCH_SIZE = 4;
      const allResults: ScoredCandidate[] = [];

      for (let i = 0; i < topCandidates.length; i += BATCH_SIZE) {
        const batch = topCandidates.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (candidate) => {
            const images = await getDiscogsReleaseImages(candidate.id, userDiscogsToken!);
            const comparison = await visualCompare(photos, images, openaiApiKey);
            return {
              result: candidate,
              visual_match_score: comparison.visual_match_score,
              same_release_likelihood: comparison.same_release_likelihood,
              same_pressing_likelihood: comparison.same_pressing_likelihood,
              visual_reason: comparison.visual_reason,
              discogsImageUrl: images[0] ?? null,
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
        discogsImageUrl: null,
      }));
    }

    console.log(`[process-record] Visual ranking completed, scored=${scored.length}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRecord(supabase, recordId, `Visual comparison failed: ${msg}`);
    return errorResponse(`Visual comparison failed: ${msg}`);
  }

  console.log(`[process-record] Writing results to database`);

  if (scored.length > 0) {
    const { error: deleteError } = await supabase
      .from("discogs_candidates")
      .delete()
      .eq("record_id", recordId);

    if (deleteError) {
      const msg = `Failed to delete old candidates: ${deleteError.message}`;
      await failRecord(supabase, recordId, msg);
      return errorResponse(msg);
    }

    const inserts = scored.map(
      ({ result, visual_match_score, same_release_likelihood, same_pressing_likelihood, visual_reason }) => ({
        record_id: recordId,
        discogs_release_id: String(result.id),
        title: result.title ?? null,
        label: (result.label ?? [])[0] ?? null,
        catno: result.catno ?? null,
        year: result.year ? parseInt(String(result.year)) : null,
        country: result.country ?? null,
        format: (result.format ?? [])[0] ?? null,
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
        thumb_url: result.thumb ?? null,
        is_selected: false,
      })
    );

    const { error: insertError } = await supabase
      .from("discogs_candidates")
      .insert(inserts);

    if (insertError) {
      const msg = `Failed to insert candidates: ${insertError.message}`;
      await failRecord(supabase, recordId, msg);
      return errorResponse(msg);
    }
  }

  const topScore = scored[0]?.visual_match_score ?? 0;
  const finalStatus = scored.length > 0 && topScore >= 30 ? "matched" : "needs_review";
  const confidence = topScore;

  const errorMsg =
    scored.length === 0
      ? !userDiscogsToken
        ? "No Discogs token configured. Add your token in Settings."
        : "No matching releases found in Discogs. Manual review required."
      : null;

  const { error: finalError } = await supabase
    .from("records")
    .update({
      status: finalStatus,
      confidence,
      error_message: errorMsg,
      processing_step: null,
    })
    .eq("id", recordId);

  if (finalError) {
    const msg = `Failed to write final status: ${finalError.message}`;
    await failRecord(supabase, recordId, msg);
    return errorResponse(msg);
  }

  console.log(`[process-record] Done record=${recordId} status=${finalStatus} topScore=${topScore}`);

  return new Response(
    JSON.stringify({
      success: true,
      status: finalStatus,
      candidates_found: scored.length,
      top_visual_score: topScore,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
