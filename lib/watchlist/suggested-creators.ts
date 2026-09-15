import type { WatchlistEntry } from './types';

export interface SuggestedCreator {
  platform: WatchlistEntry['platform'];
  label: string;
  url: string;
}

/**
 * A starter list of well-known GTA-focused creators, shown as quick-add
 * chips when a new user's watchlist is empty -- so the first thing a
 * GTA6 creator sees isn't a blank list, but names they already recognize.
 *
 * Hand-curated and checked against real, currently-active accounts (see
 * the session that added this for sources); GTA6 itself hasn't launched
 * yet, so the mix leans on established GTA V/GTA Online creators plus
 * dedicated GTA6 news/leak accounts. Every url must resolve to a real
 * @handle via lib/recap/handles.ts's normalizeHandle -- the same
 * validation the manual add-competitor form goes through -- which the
 * unit test for this file checks directly, so a future typo here fails
 * loudly instead of silently producing a dead quick-add chip.
 */
export const SUGGESTED_CREATORS: SuggestedCreator[] = [
  // YouTube
  { platform: 'youtube', label: 'Nought', url: 'https://www.youtube.com/@NoughtPointFourLIVE' },
  { platform: 'youtube', label: 'SpeirsTheAmazingHD', url: 'https://www.youtube.com/@SpeirsTheAmazingHD' },
  { platform: 'youtube', label: 'GTA Series Videos', url: 'https://www.youtube.com/@GTASeriesVideos' },
  { platform: 'youtube', label: 'MrBossFTW', url: 'https://www.youtube.com/@mrbossftw' },
  { platform: 'youtube', label: 'DarkViperAU', url: 'https://www.youtube.com/@DarkViperAU' },
  { platform: 'youtube', label: 'TGG', url: 'https://www.youtube.com/@TGG_' },
  { platform: 'youtube', label: 'iCrazyTeddy', url: 'https://www.youtube.com/@iCrazyTeddy' },
  { platform: 'youtube', label: 'Broughy1322', url: 'https://www.youtube.com/@broughy1322' },
  { platform: 'youtube', label: 'LegacyKillaHD', url: 'https://www.youtube.com/legacykillahd' },
  // TikTok
  { platform: 'tiktok', label: 'Typical Gamer', url: 'https://www.tiktok.com/@typicalgamer' },
  { platform: 'tiktok', label: 'DarkViperAU', url: 'https://www.tiktok.com/@darkviperau' },
  { platform: 'tiktok', label: 'Millionnata', url: 'https://www.tiktok.com/@gtamillionnata' },
  { platform: 'tiktok', label: 'GTA 6 ONLY', url: 'https://www.tiktok.com/@gta6only' },
  // Instagram
  { platform: 'instagram', label: 'GTA Series Videos', url: 'https://www.instagram.com/gtaseriesnews/' },
  { platform: 'instagram', label: 'gtacommunity', url: 'https://www.instagram.com/gtacommunity/' },
  { platform: 'instagram', label: 'gtaleaks', url: 'https://www.instagram.com/gtaleaks/' },
  { platform: 'instagram', label: 'fivethegamer', url: 'https://www.instagram.com/fivethegamer/' },
  { platform: 'instagram', label: 'Millionnata', url: 'https://www.instagram.com/gtamillionnata/' },
  { platform: 'instagram', label: 'gta6countdown2026', url: 'https://www.instagram.com/gta6countdown2026/' },
];
