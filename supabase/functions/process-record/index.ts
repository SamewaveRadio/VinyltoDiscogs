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
    const resultYear =
      typeof result.year === "string" ? parseInt(result.year) : result.year;
    if (resultYear === yearVal) {
      score += 5;
      reasons.push("year match");
    }
  }

  return { score, reasons };
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
    .update({ status: "failed", error_message: errorMessage })
    .eq("id", recordId);
  if (error) {
    console.error(
      `[process-record] CRITICAL: failRecord could not write to DB record=${recordId}: ${error.message}`
    );
  } else {
    console.log(
      `[process-record] failRecord wrote status=failed record=${recordId}`
    );
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

  // --- Set status to processing ---
  {
    const { error } = await supabase
      .from("records")
      .update({ status: "processing" })
      .eq("id", recordId);
    if (error) {
      const msg = `Failed to set processing status: ${error.message}`;
      await failRecord(supabase, recordId, msg);
      return errorResponse(msg);
    }
    console.log(
      `[process-record] Processing status written record=${recordId}`
    );
  }

  // --- Step 1: Fetch record photos ---
  console.log(`[process-record] Fetching record photos record=${recordId}`);
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
    console.log(
      `[process-record] Fetched ${photos.length} photos record=${recordId}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRecord(supabase, recordId, msg);
    return errorResponse(msg, 400);
  }

  // --- Fetch user's Discogs token ---
  let userDiscogsToken = discogsAppToken;
  try {
    const { data: record, error: recordError } = await supabase
      .from("records")
      .select("user_id")
      .eq("id", recordId)
      .maybeSingle();

    if (recordError)
      throw new Error(`records.user_id query failed: ${recordError.message}`);

    if (record?.user_id) {
      const { data: userProfile, error: userError } = await supabase
        .from("users")
        .select("discogs_token_encrypted, discogs_username")
        .eq("id", record.user_id)
        .maybeSingle();

      if (userError)
        throw new Error(`users query failed: ${userError.message}`);

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
    console.error(
      `[process-record] Error fetching discogs token, using app token: ${err}`
    );
  }

  // --- Step 2: OpenAI metadata extraction ---
  console.log(
    `[process-record] Starting OpenAI metadata extraction record=${recordId}`
  );
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
        image_url: { url: photo.file_url, detail: "auto" },
      }));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      let visionResponse: Response;
      try {
        visionResponse = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${openaiApiKey}`,
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
            signal: controller.signal,
          }
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!visionResponse.ok) {
        const errText = await visionResponse.text();
        throw new Error(
          `OpenAI API returned ${visionResponse.status}: ${errText}`
        );
      }

      const visionData = await visionResponse.json();
      const content = visionData.choices?.[0]?.message?.content ?? "";
      const cleanContent = content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
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
    console.log(
      `[process-record] OpenAI metadata extraction completed record=${recordId} confidence=${metadata.confidence}`
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const msg =
      raw.includes("aborted")
        ? "Metadata extraction timed out after 30s"
        : `Metadata extraction failed: ${raw}`;
    await failRecord(supabase, recordId, msg);
    return errorResponse(msg);
  }

  // --- Step 3: Save partial metadata to record ---
  console.log(
    `[process-record] Saving partial metadata record=${recordId}`
  );
  {
    const { error } = await supabase
      .from("records")
      .update({
        artist: metadata.artist,
        title: metadata.title,
        label: metadata.label,
        catalog_number: metadata.catalog_number,
        year: metadata.year,
        confidence: metadata.confidence,
      })
      .eq("id", recordId);

    if (error) {
      const msg = `Failed to save metadata: ${error.message}`;
      await failRecord(supabase, recordId, msg);
      return errorResponse(msg);
    }
    console.log(
      `[process-record] Metadata written record=${recordId}`
    );
  }

  // --- Step 4: Discogs search ---
  console.log(
    `[process-record] Starting Discogs search record=${recordId}`
  );
  let candidates: DiscogsResult[] = [];
  try {
    if (userDiscogsToken) {
      const searchParams = new URLSearchParams();
      searchParams.set("type", "release");
      searchParams.set("per_page", "25");
      if (metadata.catalog_number)
        searchParams.set("catno", metadata.catalog_number);
      if (metadata.artist) searchParams.set("artist", metadata.artist);
      if (metadata.title) searchParams.set("release_title", metadata.title);
      if (metadata.label) searchParams.set("label", metadata.label);

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
              Authorization: `Discogs token=${userDiscogsToken}`,
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
    console.log(
      `[process-record] Discogs search completed record=${recordId} candidates=${candidates.length}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRecord(supabase, recordId, `Discogs search failed: ${msg}`);
    return errorResponse(`Discogs search failed: ${msg}`);
  }

  // --- Step 5: Text-only ranking (visual ranking temporarily disabled) ---
  console.log(`[process-record] Starting text ranking record=${recordId}`);

  interface ScoredCandidate {
    result: DiscogsResult;
    score: number;
    reasons: string[];
  }

  let scored: ScoredCandidate[] = [];
  try {
    scored = candidates
      .map((result) => {
        const { score, reasons } = scoreCandidate(result, metadata);
        return { result, score, reasons };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    console.log(
      `[process-record] Text ranking completed record=${recordId} scored=${scored.length}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRecord(supabase, recordId, `Ranking failed: ${msg}`);
    return errorResponse(`Ranking failed: ${msg}`);
  }

  // --- Step 6: Database writes ---
  console.log(
    `[process-record] Writing results to database record=${recordId}`
  );

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
    console.log(
      `[process-record] Discogs candidates deleted record=${recordId}`
    );

    const inserts = scored.map(({ result, score, reasons }) => ({
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
      visual_score: null,
      visual_reason: null,
      thumb_url: result.thumb ?? null,
      is_selected: false,
    }));

    const { error: insertError } = await supabase
      .from("discogs_candidates")
      .insert(inserts);

    if (insertError) {
      const msg = `Failed to insert candidates: ${insertError.message}`;
      await failRecord(supabase, recordId, msg);
      return errorResponse(msg);
    }
    console.log(
      `[process-record] Discogs candidates inserted count=${inserts.length} record=${recordId}`
    );
  }

  const finalStatus = scored.length > 0 ? "matched" : "needs_review";
  const errorMsg =
    scored.length === 0
      ? !userDiscogsToken
        ? "No Discogs token configured. Add your token in Settings."
        : "No matching releases found in Discogs. Manual review required."
      : null;

  const { error: finalError } = await supabase
    .from("records")
    .update({ status: finalStatus, error_message: errorMsg })
    .eq("id", recordId);

  if (finalError) {
    const msg = `Failed to write final status: ${finalError.message}`;
    await failRecord(supabase, recordId, msg);
    return errorResponse(msg);
  }
  console.log(
    `[process-record] Final status written record=${recordId} status=${finalStatus}`
  );

  return new Response(
    JSON.stringify({
      success: true,
      status: finalStatus,
      metadata,
      candidates_found: scored.length,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
