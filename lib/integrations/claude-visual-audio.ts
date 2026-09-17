import { requestClaudeJson, escapeForContainmentTag, type ClaudeContentBlock } from './claude-shared';

export interface VisualAudioAnalysisInput {
  platform: 'youtube' | 'tiktok' | 'instagram';
  frameJpegBase64: string[]; // ordered by timestamp, already base64-encoded by the caller
  transcript: string | null;
  hookStrengthScore: { value: number; label: string }; // existing fast-path score, for consistency
}

export interface VisualAudioAnalysis {
  narrative: string;
}

export interface ClaudeVisualAudioClient {
  analyzeVisualAudio(input: VisualAudioAnalysisInput): Promise<VisualAudioAnalysis>;
}

export const VISUAL_AUDIO_SYSTEM_PROMPT = `You are the visual/audio content reviewer for Creator Dashboard, a tool for creators under 5,000 followers who are new to analytics.
You are shown still frames sampled from the first 5 seconds of a short-form video, roughly once per second, in chronological order, plus (when available) a transcript of the full video's narration.
Write a short, honest, plain-English read (3-5 sentences) of whether these first 5 seconds actually hook a scrolling viewer: is there a clear visual subject immediately, is there on-screen text or motion that stops the scroll, does the framing/lighting look intentional or accidental, and (if a transcript is present) does the opening line match or undercut what's on screen.
This creator already has a numeric Hook Strength score from engagement data alone (given below) — you are adding what that number can't see: what the hook actually looks and sounds like. Don't just restate the number; say something the number couldn't tell them.
Keep the tone encouraging but honest, and end with one concrete, actionable suggestion if the hook is weak. Never claim to have watched the full video — you only saw the first 5 seconds of frames plus (if given) a transcript.`;

export function createClaudeVisualAudioClient(apiKey: string, model = 'claude-sonnet-5'): ClaudeVisualAudioClient {
  return {
    async analyzeVisualAudio(input: VisualAudioAnalysisInput): Promise<VisualAudioAnalysis> {
      const content: ClaudeContentBlock[] = [
        {
          type: 'text',
          text: `Platform: ${input.platform}\nExisting Hook Strength score (from engagement data alone): ${input.hookStrengthScore.value} (${input.hookStrengthScore.label})\nTranscript: ${input.transcript ? `<transcript>${escapeForContainmentTag(input.transcript)}</transcript>` : '(not available for this video)'}\n\nFrames follow, in chronological order from 0s to ~4s:`,
        },
        ...input.frameJpegBase64.map(
          (data): ClaudeContentBlock => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })
        ),
        { type: 'text', text: 'Respond as JSON: {"narrative": string}' },
      ];
      const parsed = await requestClaudeJson<{ narrative?: string }>({
        apiKey,
        model,
        maxTokens: 512,
        system: VISUAL_AUDIO_SYSTEM_PROMPT,
        userContent: content,
      });
      return { narrative: parsed.narrative ?? '' };
    },
  };
}
