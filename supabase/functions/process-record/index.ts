import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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
  format_quantity?: number;
  thumb?: string;
  master_id?: number;
  master_url?: string;
  uri?: string;
  resource_url?: string;
  type?: string;
  genre?: string[];
  style?: string[];
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

  const resultTitle = normalize(result.title);
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    const discogsAppToken = Deno.env.get("DISCOGS_TOKEN");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { record_id } = await req.json();
    if (!record_id) {
      return new Response(JSON.stringify({ error: "record_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase
      .from("records")
      .update({ status: "processing" })
      .eq("id", record_id);

    const { data: photos, error: photosError } = await supabase
      .from("record_photos")
      .select("*")
      .eq("record_id", record_id);

    if (photosError || !photos || photos.length === 0) {
      await supabase.from("records").update({
        status: "failed",
        error_message: "No photos found for this record",
      }).eq("id", record_id);
      return new Response(JSON.stringify({ error: "No photos found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: record } = await supabase
      .from("records")
      .select("user_id")
      .eq("id", record_id)
      .maybeSingle();

    let userDiscogsToken = discogsAppToken;
    if (record?.user_id) {
      const { data: userProfile } = await supabase
        .from("users")
        .select("discogs_token_encrypted, discogs_username")
        .eq("id", record.user_id)
        .maybeSingle();
      if (userProfile?.discogs_token_encrypted) {
        userDiscogsToken = userProfile.discogs_token_encrypted;
      }
    }

    let metadata: ExtractedMetadata = {
      artist: null,
      title: null,
      label: null,
      catalog_number: null,
      year: null,
      confidence: 0,
    };

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

      if (visionResponse.ok) {
        const visionData = await visionResponse.json();
        const content = visionData.choices?.[0]?.message?.content ?? "";
        const cleanContent = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        try {
          const parsed = JSON.parse(cleanContent);
          metadata = {
            artist: parsed.artist ?? null,
            title: parsed.title ?? null,
            label: parsed.label ?? null,
            catalog_number: parsed.catalog_number ?? null,
            year: parsed.year ? parseInt(String(parsed.year)) : null,
            confidence: parsed.confidence ?? 50,
          };
        } catch {
          metadata.confidence = 20;
        }
      }
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

    await supabase.from("records").update({
      artist: metadata.artist,
      title: metadata.title,
      label: metadata.label,
      catalog_number: metadata.catalog_number,
      year: metadata.year,
      confidence: metadata.confidence,
    }).eq("id", record_id);

    const searchTerms: string[] = [];
    if (metadata.artist) searchTerms.push(metadata.artist);
    if (metadata.title) searchTerms.push(metadata.title);

    let candidates: DiscogsResult[] = [];

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

    const scoredCandidates = candidates
      .map((result) => {
        const { score, reasons } = scoreCandidate(result, metadata);
        return { result, score, reasons };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (scoredCandidates.length > 0) {
      const inserts = scoredCandidates.map(({ result, score, reasons }) => ({
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
        is_selected: false,
      }));

      await supabase.from("discogs_candidates").insert(inserts);
    }

    const finalStatus = scoredCandidates.length > 0 ? "matched" : "needs_review";
    const errorMsg =
      scoredCandidates.length === 0
        ? !userDiscogsToken
          ? "No Discogs token configured. Add your token in Settings."
          : "No matching releases found in Discogs. Manual review required."
        : null;

    await supabase.from("records").update({
      status: finalStatus,
      error_message: errorMsg,
    }).eq("id", record_id);

    return new Response(
      JSON.stringify({
        success: true,
        status: finalStatus,
        metadata,
        candidates_found: scoredCandidates.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("process-record error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
