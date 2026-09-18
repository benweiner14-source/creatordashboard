// Additive, narrative-only context layered on top of the already-calibrated
// cross-account Reach score -- never changes the numeric score/label itself.
// A purely self-referential comparison (only ever measuring an account
// against its own past) would risk recreating the exact blind spot Reach was
// built to fix: an account whose own history is chronically weak would never
// be told so, since everything looks "normal" relative to its own low bar.
// See docs/superpowers/specs/2026-09-17-reach-audience-fit-design.md's
// Non-goals ("V2: historical/percentile-based comparison") and
// docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md.
const MIN_HISTORY_FOR_COMPARISON = 3;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * pastScores: this profile's most recent prior Reach scores (0-100),
 * excluding the current diagnostic. Order doesn't matter here (median/max
 * are order-independent) -- the caller controls the window size (e.g. "last
 * 20"), not this function.
 */
export function describeReachRelativeToHistory(currentScore: number, pastScores: number[]): string | null {
  if (pastScores.length < MIN_HISTORY_FOR_COMPARISON) return null;

  if (currentScore > Math.max(...pastScores)) {
    return `This is your best Reach score out of your last ${pastScores.length} diagnosed posts.`;
  }

  const mid = median(pastScores);
  if (currentScore > mid) {
    return "Your reach here is above what's typical for your own recent posts.";
  }
  if (currentScore < mid) {
    return "Your reach here is below what's typical for your own recent posts.";
  }
  return 'Your reach here is about typical for your own recent posts.';
}
