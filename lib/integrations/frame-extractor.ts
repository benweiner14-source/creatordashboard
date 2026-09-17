export interface ExtractedFrame {
  timestampSeconds: number;
  imageUrl: string;
}

export interface FrameExtractorClient {
  extractFrames(videoUrl: string, timestampSeconds: number[]): Promise<ExtractedFrame[]>;
}

const FRAME_EXTRACTOR_ACTOR_ID = 'automation-lab~video-thumbnail-frame-extractor';

// First 5 seconds, sampled every half second — validated against a real video
// during this feature's design (all 10/10 frames succeeded). Denser than
// 1-second sampling roughly doubles the per-diagnostic Apify cost, but stays
// well under the cost of TikTok's native full-video AI add-ons for any video
// longer than ~36s — see design spec §5.
export const HOOK_WINDOW_TIMESTAMPS_SECONDS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5];

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
          imageUrl: `${String(item.storedFileUrl)}?token=${apiToken}`,
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
