export interface ExtractedFrame {
  timestampSeconds: number;
  imageUrl: string;
}

export interface FrameExtractorClient {
  extractFrames(videoUrl: string, timestampSeconds: number[]): Promise<ExtractedFrame[]>;
}

const FRAME_EXTRACTOR_ACTOR_ID = 'automation-lab~video-thumbnail-frame-extractor';

// First 5 seconds, sampled once per second. Half-second sampling (10 frames)
// was validated during this feature's design and worked, but sat too close to
// the route's 60s Vercel ceiling — a timeout there leaves the row stranded at
// 'pending'. Halving the frame count roughly halves both of the pipeline's
// largest variable-cost steps: the per-frame Apify frame-extraction cost and
// the Claude vision call's image-token cost and latency. 5 frames still covers
// the whole hook window at 1s granularity — see design spec §5.
export const HOOK_WINDOW_TIMESTAMPS_SECONDS = [0, 1, 2, 3, 4];

// Always an api.apify.com key-value-store URL, but built with URL/searchParams
// rather than string concatenation so a pre-existing query string on the
// stored-file URL can never produce a malformed double-`?` URL.
function withApifyToken(rawUrl: string, apiToken: string): string {
  const url = new URL(rawUrl);
  url.searchParams.set('token', apiToken);
  return url.toString();
}

export function createApifyFrameExtractorClient(apiToken: string): FrameExtractorClient {
  return {
    async extractFrames(videoUrl: string, timestampSeconds: number[]): Promise<ExtractedFrame[]> {
      const response = await fetch(
        `https://api.apify.com/v2/acts/${FRAME_EXTRACTOR_ACTOR_ID}/run-sync-get-dataset-items?token=${apiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // NOT plain strings — the actor's schema requires {url} objects.
            // A plain string array fails with a misleading "do not contain
            // valid URLs" error even for a real, reachable URL. Confirmed
            // during this feature's design.
            videoUrls: [{ url: videoUrl }],
            timestampSeconds,
            // Lowercase — "JPEG" is rejected by the actor's enum validation.
            // Confirmed during this feature's design.
            outputFormat: 'jpeg',
            quality: 85,
          }),
        }
      );
      if (!response.ok) {
        throw new Error(`Frame extraction failed with status ${response.status}`);
      }
      const items: Array<Record<string, unknown>> = await response.json();
      return items
        .filter((item) => item.status === 'succeeded')
        .map((item) => ({
          timestampSeconds: Number(item.timestampSeconds),
          imageUrl: withApifyToken(String(item.storedFileUrl), apiToken),
        }));
    },
  };
}

export async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch frame image: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}
