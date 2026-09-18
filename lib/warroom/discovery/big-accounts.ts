/**
 * Curated list for the "big account" discovery tier, mirroring the reference
 * Social War Room system's ~60-70 known NBA/2K team/media accounts — a
 * separate profile-scraping mode alongside broad hashtag/keyword discovery,
 * with its own looser threshold tier (see scoring.ts). Originally cut from
 * the initial build as Non-goal #9 (design spec,
 * docs/superpowers/specs/2026-09-15-gta6-war-room-design.md); this is that
 * fast-follow.
 *
 * Verified live via Apify (2026-09-18) rather than assumed from memory —
 * each handle below actually exists, posts GTA6-relevant content, and its
 * follower count was confirmed at verification time. Real accounts drift
 * (rename, go private, lose relevance) — revisit this list periodically
 * rather than treating it as permanent.
 */
export const GTA6_BIG_ACCOUNTS_TIKTOK: string[] = ['fubzy04', 'toasty_editz', '1deflay', 'vicespotted', 'typicalgamer'];

export const GTA6_BIG_ACCOUNTS_INSTAGRAM: string[] = ['flowgamestv', 'gta6.only', 'typicalgamer'];
