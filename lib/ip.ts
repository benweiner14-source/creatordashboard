export interface DeriveClientIpParams {
  headers: { get(name: string): string | null };
  /** True when running on a platform (e.g. Vercel) whose edge sets/rewrites x-forwarded-for itself, so a client cannot forge it. */
  isTrustedPlatform: boolean;
  /**
   * For self-hosted deployments behind the operator's own reverse proxy(s):
   * how many hops of x-forwarded-for were appended by proxies we trust.
   * Everything to the left of that could be attacker-supplied. Omit (or 0)
   * to not trust the header at all — the safe default for an unconfigured
   * self-hosted deployment.
   */
  trustedProxyHops?: number;
}

const UNKNOWN_IP = '0.0.0.0';

export function deriveClientIp(params: DeriveClientIpParams): string {
  const raw = params.headers.get('x-forwarded-for');
  if (!raw) return UNKNOWN_IP;

  const chain = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (chain.length === 0) return UNKNOWN_IP;

  if (params.isTrustedPlatform) {
    // The platform's edge is the sole entity that sets this header before
    // our code ever sees it, so the first (leftmost, earliest-appended)
    // entry is the real client IP.
    return chain[0];
  }

  const hops = params.trustedProxyHops ?? 0;
  if (hops <= 0) {
    // We cannot tell a client-supplied header from a proxy-appended one
    // without an explicit trust configuration — deliberately don't trust
    // any part of the chain.
    return UNKNOWN_IP;
  }

  // Each trusted proxy appends to the right end of the chain, so the
  // entry `hops` positions from the right is the earliest one a trusted
  // proxy actually observed.
  const index = chain.length - hops;
  return index >= 0 ? chain[index] : UNKNOWN_IP;
}
