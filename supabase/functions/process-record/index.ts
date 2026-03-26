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

interface ExtractedMetadata {
  artist: string | null;
  title: string | null;
  label: string | null;
  catalog_number: string | null;
  year: number | null;
  confidence: number;
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
  type?: string;
  genre?: string[];
  style?: string[];
}

interface DiscogsImage {
  type: string;
  uri: string;
  resource_url: string;
  uri150: string;
  width: number;
  height: number;
}

interface DiscogsReleaseDetail {
  id: number;
  images?: DiscogsImage[];
}

function scoreCandidate(
  result: DiscogsResult,
  metadata: ExtractedMetadata
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const normalize = (s: string | null | undefined) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const catnoNorm = normalize(metadata.catalog_number);
  const labelNorm = normalize(metadata.label);
  const yearVal = metadata.year;

  const resultCatno = normalize(result.catno);
  const resultLabel = normalize((result.label ?? [])[0]);
  const [artistPart, titlePart] = result.title.includes(" - ")
    ? result.title.split(" - ", 2)
    : [result.title, ""];

  const artistNorm = normalize(metadata.artist);
  const titleNorm = normalize(metadata.title);

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

  if (yearVal && result.year) {
    const resultYear = typeof result.year === "string" ? parseInt(result.year) : result.year;
    if (resultYear === yearVal) {
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
    const data: DiscogsReleaseDetail = await res.json();
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

async function failRecord(
  supabase: ReturnType<typeof createClient>,
  recordId: string,
  errorMessage: string
) {
  console.error(`[process-record] FAILED record=${recordId}: ${errorMessage}`);
  await supabase.from("records").update({
    status: "failed",
    error_message: errorMessage,
  }).eq("id", recordId);
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
    return new Response(
      JSON.stringify({ error: "Invalid request body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!recordId) {
    return new Response(
      JSON.stringify({ error: "record_id is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[process-record] START record=${recordId}`);

  await supabase.from("records").update({ status: "processing" }).eq("id", recordId);

  // --- Step 1: Fetch record photos ---
  console.log(`[process-record] Fetching record photos record=${recordId}`);
  let photos: { file_url: string; photo_type: string }[];
  try {
    const { data, error: photosError } = await supabase
      .from("record_photos")
      .select("*")
      .eq("record_id", recordId);

    if (photosError) throw new Error(photosError.message);
    if (!data || data.length === 0) throw new Error("No photos found for this record");
    photos = data;
    console.log(`[process-record] Fetched ${photos.length} photos record=${recordId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRecord(supabase, recordId, msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // --- Fetch user's Discogs token ---
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
        .select("discogs_token_encrypted, discogs_username")
        .eq("id", record.user_id)
        .maybeSingle();
      if (userProfile?.discogs_token_encrypted) {
        try {
          userDiscogsToken = await decryptToken(userProfile.discogs_token_encrypted, supabaseServiceKey);
        } catch {
          userDiscogsToken = userProfile.discogs_token_encrypted;
        }
      }
    }
  } catch (err) {
    console.error(`[process-record] Error fetching discogs token, using app token: ${err}`);
  }

  // --- Step 2: OpenAI metadata extraction ---
  console.log(`[process-record] Starting OpenAI metadata extraction record=${recordId}`);
  let metadata: ExtractedMetadata = {
    artist: null,
    title: null,
    label: null,
    catalog_number: null,
    year: null,
    confidence: 0,
  };

  try {
    if (openaiApiKey) {
      const imageContents = photos.slice(0, 4).map((photo) => ({
        type: "image_url",
        image_url: { url: photo.file_url, detail: "high" },
      }));

      const visionResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          max_tokens: 500,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Analyze these vinyl record photos and extract the following information. Return ONLY a valid JSON object with no markdown or explanation:
{
  "artist": "artist name or null",
  "title": "album title or null",
  "label": "record label name or null",
  "catalog_number": "catalog number (e.g. ABC-1234) or null",
  "year": numeric year as integer or null,
  "confidence": integer from 0-100 indicating how confident you are in the extraction
}
Focus on the record labels (sides A and B) for catalog number and label information. Use the cover for artist and title.`,
                },
                ...imageContents,
              ],
            },
          ],
        }),
      });

      if (!visionResponse.ok) {
        const errText = await visionResponse.text();
        throw new Error(`OpenAI API returned ${visionResponse.status}: ${errText}`);
      }

      const visionData = await visionResponse.json();
      const content = visionData.choices?.[0]?.message?.content ?? "";
      const cleanContent = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleanContent);
      metadata = {
        artist: parsed.artist ?? null,
        title: parsed.title ?? null,
        label: parsed.label ?? null,
        catalog_number: parsed.catalog_number ?? null,
        year: parsed.year ? parseInt(String(parsed.year)) : null,
        confidence: parsed.confidence ?? 50,
      };
    } else {
      metadata = {
        artist: "Unknown Artist",
        title: "Unknown Title",
        label: null,
        catalog_number: null,
        year: null,
        confidence: 0,
      };
    }
    console.log(`[process-record] OpenAI metadata extraction completed record=${recordId} confidence=${metadata.confidence}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRecord(supabase, recordId, `Metadata extraction failed: ${msg}`);
    return new Response(
      JSON.stringify({ error: `Metadata extraction failed: ${msg}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // --- Step 3: Save partial metadata to record ---
  console.log(`[process-record] Saving partial metadata record=${recordId}`);
  try {
    await supabase.from("records").update({
      artist: metadata.artist,
      title: metadata.title,
      label: metadata.label,
      catalog_number: metadata.catalog_number,
      year: metadata.year,
      confidence: metadata.confidence,
    }).eq("id", recordId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRecord(supabase, recordId, `Failed to save metadata: ${msg}`);
    return new Response(
      JSON.stringify({ error: `Failed to save metadata: ${msg}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // --- Step 4: Discogs search ---
  console.log(`[process-record] Starting Discogs search record=${recordId}`);
  let candidates: DiscogsResult[] = [];
  try {
    if (userDiscogsToken) {
      const searchParams = new URLSearchParams();
      searchParams.set("type", "release");
      searchParams.set("per_page", "25");
      if (metadata.catalog_number) searchParams.set("catno", metadata.catalog_number);
      if (metadata.artist) searchParams.set("artist", metadata.artist);
      if (metadata.title) searchParams.set("release_title", metadata.title);
      if (metadata.label) searchParams.set("label", metadata.label);

      const discogsRes = await fetch(
        `https://api.discogs.com/database/search?${searchParams.toString()}`,
        {
          headers: {
            "Authorization": `Discogs token=${userDiscogsToken}`,
            "User-Agent": "VinylToDiscogs/1.0",
          },
        }
      );

      if (discogsRes.ok) {
        const discogsData = await discogsRes.json();
        candidates = discogsData.results ?? [];
      }

      const searchTerms: string[] = [];
      if (metadata.artist) searchTerms.push(metadata.artist);
      if (metadata.title) searchTerms.push(metadata.title);

      if (candidates.length === 0 && searchTerms.length > 0) {
        const fallbackParams = new URLSearchParams();
        fallbackParams.set("type", "release");
        fallbackParams.set("per_page", "25");
        fallbackParams.set("q", searchTerms.join(" "));

        const fallbackRes = await fetch(
          `https://api.discogs.com/database/search?${fallbackParams.toString()}`,
          {
            headers: {
              "Authorization": `Discogs token=${userDiscogsToken}`,
              "User-Agent": "VinylToDiscogs/1.0",
            },
          }
        );

        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          candidates = fallbackData.results ?? [];
        }
      }
    }
    console.log(`[process-record] Discogs search completed record=${recordId} candidates=${candidates.length}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRecord(supabase, recordId, `Discogs search failed: ${msg}`);
    return new Response(
      JSON.stringify({ error: `Discogs search failed: ${msg}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // --- Step 5: Ranking ---
  console.log(`[process-record] Starting ranking record=${recordId}`);
  interface VisualResult {
    result: DiscogsResult;
    score: number;
    reasons: string[];
    visual_score: number | null;
    visual_reason: string | null;
  }

  let visuallyScored: VisualResult[] = [];
  try {
    const textScored = candidates
      .map((result) => {
        const { score, reasons } = scoreCandidate(result, metadata);
        return { result, score, reasons };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const uploadedPhotoUrl = photos.find((p) => p.photo_type === "cover_front")?.file_url
      ?? photos[0]?.file_url ?? null;

    const top5 = textScored.slice(0, 5);
    const rest = textScored.slice(5);

    if (openaiApiKey && userDiscogsToken && uploadedPhotoUrl && top5.length > 0) {
      const visualResults = await Promise.all(
        top5.map(async ({ result, score, reasons }) => {
          const releaseImageUrl = await getDiscogsReleaseImage(result.id, userDiscogsToken!);
          if (!releaseImageUrl) {
            return { result, score, reasons, visual_score: null, visual_reason: null };
          }
          const { visual_score, visual_reason } = await getVisualScore(
            uploadedPhotoUrl,
            releaseImageUrl,
            openaiApiKey
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
    console.log(`[process-record] Ranking completed record=${recordId} scored=${visuallyScored.length}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRecord(supabase, recordId, `Ranking failed: ${msg}`);
    return new Response(
      JSON.stringify({ error: `Ranking failed: ${msg}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // --- Step 6: Database writes ---
  console.log(`[process-record] Writing results to database record=${recordId}`);
  try {
    if (visuallyScored.length > 0) {
      await supabase.from("discogs_candidates").delete().eq("record_id", recordId);

      const inserts = visuallyScored.map(({ result, score, reasons, visual_score, visual_reason }) => ({
        record_id: recordId,
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

      await supabase.from("discogs_candidates").insert(inserts);
    }

    const finalStatus = visuallyScored.length > 0 ? "matched" : "needs_review";
    const errorMsg =
      visuallyScored.length === 0
        ? !userDiscogsToken
          ? "No Discogs token configured. Add your token in Settings."
          : "No matching releases found in Discogs. Manual review required."
        : null;

    await supabase.from("records").update({
      status: finalStatus,
      error_message: errorMsg,
    }).eq("id", recordId);

    console.log(`[process-record] Database writes completed record=${recordId} status=${finalStatus}`);

    return new Response(
      JSON.stringify({
        success: true,
        status: finalStatus,
        metadata,
        candidates_found: visuallyScored.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRecord(supabase, recordId, `Database write failed: ${msg}`);
    return new Response(
      JSON.stringify({ error: `Database write failed: ${msg}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
