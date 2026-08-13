# Platform Feature-Change Monitoring Log

This log tracks changes to TikTok, YouTube Shorts, and Instagram Reels
that could make the Diagnostic feature's scoring stale — specifically,
anything affecting ranking/distribution, hook or retention behavior,
ideal video length, or posting-time patterns. Those are the inputs
`lib/diagnostic/hook-strength.ts`, `lib/diagnostic/retention-risk.ts`,
`lib/diagnostic/timing.ts`, and `lib/diagnostic/format-fit.ts` are
calibrated against (see
`docs/superpowers/specs/2026-08-13-diagnostic-benchmark-sources.md`
for where those original thresholds came from).

A scheduled Routine researches this monthly and appends an entry here
whenever it finds something that looks material. Runs that find
nothing worth flagging don't get an entry — this file is a record of
signal, not a run log.

## Entry format

```
## YYYY-MM-DD

**What changed:** <short description>
**Source(s):** <links>
**Affects scoring?** <yes/no/unclear, and which file(s) if yes>
**Recommendation:** <what to do about it, if anything>
```

## Entries

_(none yet — this file is created alongside the monitoring Routine; the first entry will land whenever a run finds something material.)_
