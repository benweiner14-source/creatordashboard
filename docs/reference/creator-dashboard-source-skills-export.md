# Creator Dashboard — Source Skill Export

Companion to [creator_dashboard_product_brief.md](creator_dashboard_product_brief.md). This file collects the actual literal content of every Claude Code skill (and its supporting scripts) that the brief's features are built on, so it can be pulled off this machine and adapted into the product's backend.

**Read this before copying anything into the product:**

These are Claude Code skill files — markdown instructions written for an AI agent to follow, not backend application code. Most of them reference Claude-Code-specific tools, file paths on this machine, and other skills by name. "Exporting" them means extracting the actual domain knowledge — the rules, examples, ranking logic, style guides, prompt templates — and rewriting it as a clean system prompt for whatever API the product calls (Claude API, OpenAI, etc.), stripping the Claude-Code-specific tool references.

Two of these (`2k-monthly-report`, `2k-yt-transcript`) include real portable Python scripts alongside the instructions — those are directly reusable as code, not just prompt material.

---

## Mapping — brief feature → source file

| Brief feature (section) | Source skill | Type |
|---|---|---|
| Weekly content ideas (5.2) | `ronnie2k-content-ideas` | Prompt/instructions only |
| Recap card (5.3) | `2k-monthly-report` | Instructions **+ working Python scripts** |
| Hook generator (6) | `2k-hook` | Prompt/instructions only |
| AI-writing cleanup (6) | `avoid-ai-writing` | Prompt/instructions only (identical copy exists in both project and global `~/.claude/skills/`) |
| Transcript puller (6) | `2k-yt-transcript` | Instructions **+ working Python script** |
| Thumbnail maker (6b) | `2k-thumbnail-style` | Prompt/instructions only |
| Avatar-ify (6a) | `2k-cutscene-style` | Prompt/instructions only (+ 158 reference screenshots not reproduced here — image files, see the skill's own folder) |
| Avatar-ify supporting technique | `seedance2-skill`, `video-prompting-skill` | Prompt/instructions only — **flagged: these two have `.git`/`README`/`LICENSE` files, i.e. they look like cloned third-party/open-source repos, not original work. Check license terms before building commercial logic on them.** |
| Shelved (6a-shelved) — kept for reference only | `2k-heygen-avatar-reference`, `2k-elevenlabs-vo-guide` | Prompt/instructions only |

**Not included below — tied to rejected/excluded brief ideas:** `2k-ronnie2k-copy-style` (voice-calibration, rejected), `ronnie2k-reply-radar` / `ronnie2k-reply-radar-2` (rejected), `2k-ig-dm-history-lookup` (tied to excluded DM tooling), `park-sessions-editor` / `2k-paper-cut` / `2k-paper-cut-workspace` (discussed, not picked up), `ronnie2k-post-search` (minor idea, not picked up).

---

## 1. Weekly Content Ideas

**Source:** `.claude/skills/ronnie2k-content-ideas/SKILL.md`

```markdown
---
name: ronnie2k-content-ideas
description: Weekly content ideation for the Ronnie2K / NBA 2K brand. Researches what's hot in the NBA and NBA 2K world right now and returns a ranked shortlist of Reel and Instagram-carousel concepts, tagged by medium and format. Use when the user says "weekly ideas," "content ideas," "reel ideas," "carousel ideas," "what should Ronnie post," "video topics for the week," or invokes /ronnie2k-content-ideas. Concepts only — chain into 2k-hook and 2k-ronnie2k-copy-style to actually build a picked idea.
---

# Ronnie2K Content Ideas

Run this once a week. It researches the current NBA / NBA 2K moment and hands back a
**ranked shortlist of ~6–8 concepts** for short-form vertical video (IG Reels / TikTok)
and Instagram carousels, tagged by medium and format.

This skill pitches **concepts only.** It does not write full scripts, design carousel
graphics, or post anything. When the user picks an idea, chain into `/2k-hook` (opening
line) and `/2k-ronnie2k-copy-style` (script / slide copy / caption) to build it out.

---

## How to run

1. **Anchor to today.** Note the current date and where the NBA calendar sits
   (offseason / draft / Summer League / free agency / preseason / regular season /
   playoffs / Finals). Ideas must fit the moment.
2. **Research** the week (see Research phase). All ideas timely, scoped to **shoot in
   the next ~7 days.**
3. **Generate** ~6–8 ideas, each mapped to a format from one of the two libraries below.
4. **Rank** by distribution potential (see Ranking).
5. **Present** the ranked list in chat, then **save** a dated file (see Output).

No repeat-log is kept and Ronnie's own past posts are not scraped — each run is
standalone. If the user wants a specific medium only ("just carousels this week"),
honor it; otherwise return both.

---

## Research phase

Every run, pull from the live web:

- **NBA news** — trades, signings, injuries, roster moves, Summer League, awards,
  standings, milestones, retirements, drama/storylines with momentum.
- **NBA 2K news** — ratings drops/updates, patch notes, Seasons, MyTEAM releases,
  NBA 2K27 / franchise news, cover athletes, community controversies.
- **What other 2K/NBA creators are riding** — trending angles, formats, and audio worth
  jumping on while there's momentum.

Use WebSearch. Prefer things that broke in the **last few days** over stale evergreen
topics. For each idea, capture the specific **news peg** (what happened, when) and a source.

**Do NOT** invent news. If you can't find a real, current hook, say so rather than
manufacturing a generic calendar-based one.

---

## Ranking — distribution potential

Rank by **distribution potential**, not raw "virality." The 2026 IG/TikTok algorithm
rewards **saves and DM shares** over reach, so weigh three signals:

1. **Shareability** — would someone DM this to a friend or drop it in the group chat?
   (Mosseri's stated priority: DM shares → Stories → Feed. Weight this heavily.)
2. **Savability** — would someone save it to come back to? Rankings, lists, breakdowns,
   tutorials, and "did 2K call it" receipts win here.
3. **Reach / scroll-stop** — hook strength and trend momentum.

Judge each idea against the KPI **its own format is built to hit** — carousels skew
save-heavy, Reels skew share/reach — rather than forcing one yardstick across both.
Every idea gets a one-line **"why it ranks here"** naming the KPI(s) it lands.

---

## Library A — Vertical video formats (Reels / TikTok, VO + B-roll)

Talking-head Ronnie avatar and/or VO over B-roll built from **player/team images,
in-game 2K gameplay capture, or ripped YouTube clips.** Target length up to 90s (both
platforms now give a distribution bonus to 60–90s clips that hold watch-time). Each idea
specifies **talking-head-led** vs **VO-over-capture**.

**Ranking & list**
1. **Ranked Countdown** — Top-N counting 5→1, B-roll per entry.
2. **Tier List** — drop items into S/A/B/C on screen, VO defends each.
3. **Listicle** — numbered, not ranked ("5 things only day-one 2K players remember").
4. **Bracket** — seed a field, VO walks the elimination.
5. **Draft-a-Squad** — repeated this-or-that to build a lineup.

**Debate & take**
6. **Hot Take** — one bold claim, defended with evidence B-roll.
7. **Myth-Buster** — "Actually, that's wrong…" with proof.
8. **Overrated / Underrated** — rapid-fire verdicts over clips.
9. **Report Card** — grade players/teams/the game, letter grades on screen.

**Story & explainer**
10. **Explainer** — "How X actually works" (e.g. how 2K ratings get set).
11. **Rise & Fall Timeline** — a career or franchise arc, chronological B-roll.
12. **Untold Story** — "What happened to…" mini-doc on a forgotten player/moment.
13. **Speed Recap** — compress a season/event into ~60s.

**Prediction & sim**
14. **The Sim** — "I simmed X in 2K," narrate how it plays out.
15. **Prediction** — "Calling it now," forecast with reasoning.
16. **Did-the-Game-Call-It** — callback: a past 2K sim/rating vs what really happened.

**Reaction & trend**
17. **Reaction** — "They said WHAT?" VO over the source quote/clip.
18. **Build Challenge** — recreate a real player as a MyPLAYER, reveal the result.
19. **Then vs Now** — evolution comparison, side-by-side B-roll.
20. **Trend-Jack** — borrow a currently-viral audio/format and apply it to 2K/NBA.

---

## Library B — Instagram carousel formats

Carousels were named the **best-performing format by ~70% of brands** in Link in Bio's
2025 survey (ahead of short-form video) and get re-served to the feed on each un-swiped
slide, so they are a real growth/follower engine. Source assets: **player/team images,
in-game gameplay capture, ripped YouTube/presser/pod clips, stat graphics.**

**Story-driven**
1. **Conversational** — a Reel VO script broken into swipeable text over images/gameplay
   (native IG font so it feels organic).
2. **Storytime (text-only)** — copy carries it, no photos needed.
3. **Captioned (quote-per-slide)** — rip a clip, one shareable quote per slide.
4. **Cliffhanger** — every slide ends on a hook forcing the next tap; payoff on the last.

**List & rank**
5. **Ranked Listicle** — numbered, one per slide.
6. **Tier List** — S/A/B/C across slides.
7. **Data/Stat** — big bold number leads, each slide unpacks it.
8. **"Did 2K Call It" receipts** — screenshot proof across slides.

**Visual & interactive**
9. **Gamified (swipe-to-X)** — slide 1 directs an action ("swipe to reveal his rating,"
   "swipe to age this rookie into a vet").
10. **Before / After** — side-by-side contrast.
11. **Panoramic pan** — one continuous image split across slides.
12. **Vignette** — cinematic clip stitch with one through-line.
13. **Zine / collage** — mixed-media themed dump (draft-night scrapbook).

**Engagement bait**
14. **Choose-One poll** — "Which build are you?" swipe-through.
15. **Collection showcase** — new drops (MyTEAM cards, Season rewards).

### Carousel cover-slide hook formulas (pick one per carousel)
1. **Question-then-answer** — pose it, answer across the swipe.
2. **Surprising fact / big bold number** — short, shocking, easy to digest.
3. **Side-by-side comparison** — show, don't tell.
4. **Swipe-for-X (gamified)** — slide 1 directs a simple action.
5. **Jump mid-story** — drop people into the middle of a story.
6. **Stunning visual (no text)** — a frame worth sending a friend.

### Carousel rules (enforce on every carousel idea)
- Slide 1 is ~80% of the game. **Also** hook slide 2 — it gets re-served as standalone
  content in the feed.
- Put the text **ON the images**, not in the caption. People don't expand captions.
- 8–12 slides typical (up to ~20 for deep dives). Curation over volume — there must be
  a reason for it to be a carousel, not a random dump.
- 4:5 ratio (1080×1350) for max screen space.
- Last slide = the payoff/reveal + screenshot-worthy. Group-chat test: would someone
  send this slide to a friend?
- Build for **saves + DM shares**, and back the format with a real payoff (intel,
  reveal, useful read) — not empty hype.
- Avoid the 4 killers: no theme/purpose, caption-instead-of-on-slide-text, weak hook,
  over-designed.

---

## Cross-format rule

A hot topic can be pitched in **both** mediums when it genuinely fits (e.g. a rookie
tier list works as a Reel countdown and a save-heavy carousel). When you do this, note
**which medium is stronger** for that topic and why.

---

## Each idea card contains

- **Working title** + one-line pitch
- **Medium** (Reel / Carousel / Both) + **Format** (from Library A or B)
- **Why it's hot now** — the news peg with source
- **Why it ranks here** — the KPI(s) it lands (shareable / savable / reach)
- *If Reel:* suggested length (≤90s) · talking-head-led vs VO-over-capture ·
  B-roll / capture needed
- *If Carousel:* which hook formula + the actual cover line · slide arc & count ·
  key-slide content · source assets
- **Ronnie insider angle** — only when one genuinely exists (his access, ratings POV,
  history). Don't force one onto every idea.
- Light 2K flavor; product tie-ins (NBA 2K27 / MyTEAM / ratings / Seasons) only when the
  news warrants it.

---

## Guardrails

Any on-brand copy drafted here (titles, hook lines, slide text) must follow
`/2k-ronnie2k-copy-style` and be scrubbed with `/avoid-ai-writing`. Core brand rules:

- **No gambling / betting language** anywhere. No "bet," "odds," "pay up," stakes framing.
- **No disparaging NBA players** — 2K is an NBA partner. References are competitive,
  neutral, or positive.
- **"My MyPLAYER," never "avatar"** in public-facing copy.
- Mode styling: **MyTEAM / MyPLAYER / MyCAREER**.
- Ronnie is the **messenger, not the decision-maker** on ratings ("I had to deliver this
  rating," never "I set it").

---

## Output

1. Present the ranked shortlist in chat, best-first, each as an idea card.
2. Save a dated markdown file of the full list to:
   `Ronnie2K Content Ideas/YYYY-MM-DD-content-ideas.md` in the project folder
   (create the folder if it doesn't exist). Use the run date.

---

## Non-goals

- Does not write full scripts or slide-by-slide final copy → chain `/2k-ronnie2k-copy-style`.
- Does not design or generate carousel graphics/images.
- Does not post or schedule anything.
- Does not keep a repeat-log or scrape Ronnie's own posts.
```

---

## 2. Recap Card

**Source:** `.claude/skills/2k-monthly-report/SKILL.md`

```markdown
---
name: 2k-monthly-report
description: Turn a folder of raw Sprinklr (+ optional YouTube Studio) CSV exports into a branded 2K/Ronnie2K monthly social stats PDF. Use when the user drops in monthly export CSVs and asks for the monthly report, wants to regenerate July's/last month's/this month's social stats report, or invokes /2k-monthly-report.
---

# 2K Monthly Report

Replaces the old n8n-based "2K Monthly Social Stats — Report Generator" and
"Ronnie2K Monthly Social Stats - Report Generator" workflows (both retired
2026-08-04 after a views-calculation bug and a Google Sheets data-loss
incident during a live debugging session). This skill does the same job with no email
automation, no live spreadsheet writes, and numbers you can verify before
anything goes out.

## What it does

1. You give it a folder of CSVs (however many files, whatever they're
   named — filenames are never trusted, only content).
2. `scripts/generate_report.py` finds the real post-level Sprinklr export
   and an optional YouTube Studio supplemental by **content signature**,
   figures out which account it is (2k vs ronnie2k) and which month the
   data covers, computes per-platform totals, and pulls in local
   month-over-month history.
3. You (Claude) review the computed numbers, write the analysis
   paragraph yourself — no external AI API call — and hand it to
   `scripts/render_pdf.py`, which renders the branded HTML via a headless
   browser (Playwright + system Chrome or bundled Chromium) into a PDF.
4. Hand the PDF to Ben via SendUserFile. He reviews it and sends it
   himself — this skill never sends anything.

## Running it

```bash
python3 "scripts/generate_report.py" /path/to/csv/folder
```

Prints a JSON object with `account`, `period`, `platform_data`, `totals`,
`top3_posts`, `history` (MoM/YoY comparison), and `skipped_files` (with
reasons — check this if a file you expected to be picked up wasn't).

Read the output before doing anything else. Sanity-check the numbers against
something you can independently verify if anything looks off (a platform's
own dashboard, a manual count) — this exact workflow caught a real
double-counting bug and a missing-column bug during development by doing
that. Don't skip it just because the pipeline ran without errors.

Then write the commentary paragraph(s) yourself (plain text, blank line
between paragraphs, 3–5 short paragraphs, specific numbers not generic
praise — see the examples in `output/*_commentary.txt` from the July 2026
run for the tone/length target). Run `/avoid-ai-writing` on your own draft
before rendering; this is public-facing copy.

**Ben's standing platform priorities (confirmed 2026-08-04, encoded in
`render_pdf.py`'s `PLATFORM_TIER` dict — you don't need to ask again unless
he says it changed):** for both accounts, **Instagram, Twitter/X, and TikTok
are primary** — the breakdown table lists them first, in that order, and the
commentary should lead with them. **YouTube, Facebook, and Threads are
secondary** for both accounts — the table groups them below a "SECONDARY
PLATFORMS" divider row, and the commentary should cover them briefly,
usually in one closing sentence together (see the July 2026 commentary
examples). If a future month's data includes a platform not in this list,
`sort_platforms()` puts it at the end of the secondary group rather than
silently treating it as important — check `PLATFORM_TIER` in
`scripts/render_pdf.py` if that ever needs updating.

**Ben's standing preferences for this commentary (confirmed 2026-08-04):**
audience is mixed (execs + social team, so lead with the headline number,
then back it with tactical/content-type detail); keep it a tightened factual
recap, not a set of recommendations — every sentence should carry a
specific number or comparison, nothing generic; always fold in the
`content_type_breakdown` field per platform (video vs photo vs carousel vs
Reel/Story/Feed, whatever the export actually supports — see below). Ask
again if these preferences seem to have changed, but don't re-ask every run.

`content_type_breakdown` (in the JSON from `generate_report.py`) is keyed by
platform, then content-type label, with `total_views`/`total_engagements`/
`post_count`. It reconciles exactly against each platform's own totals (verified
against real July data for both accounts) — cite it directly, don't recompute.
Two different signal sources feed it, and **which one applies depends on the
account's export, not a setting you choose**:
- If the main export has a `Media Type` column (2K Brand's does), every
  platform gets a real breakdown straight from it.
- If it doesn't (Ronnie2K's doesn't), only Instagram gets one, derived from
  its own `Permalink` URL shape (`/stories/`, `/reel/`, `/p/` are reliable
  markers; no other platform's URLs work this way). Check
  `platforms_without_content_type_signal` in the output — for those
  platforms, say plainly that this export doesn't break them down by
  content type, rather than omitting the gap silently or guessing from one
  of the folder's other loose CSVs (a real attempt at that during
  development hit files with post counts that didn't reconcile and at least
  one file whose target platform wasn't even labeled — not worth the risk
  of a wrong attribution for a "nice to have" stat).

Save the commentary to a `.txt` file, then:

```bash
python3 "scripts/render_pdf.py" report_data.json commentary.txt output.pdf
```

This also writes a `.debug.html` next to the PDF — open it in a browser
tab if the PDF layout looks wrong and you need to iterate faster than a
full PDF re-render.

To also record this run in the local history file (so next month gets a
real MoM comparison), add `--commit` to the `generate_report.py` call. It
will refuse (safely, no duplicate rows) if that period is already recorded
— check `history/<account>_history.json` and remove the existing rows
yourself if you genuinely need to overwrite one.

## Design decisions (read before changing the classification/formula logic)

These came from real bugs found against real July 2026 exports for both
accounts — don't revert them without re-verifying against real data first:

- **Never classify by filename.** Both accounts' folders contain multiple
  CSVs that could plausibly be "the" main export by name; only the header
  signature (`account type` + `published date` + `total engagements (sum)`
  + `post reach (sum)`) reliably identifies it — and even that alone can be
  ambiguous (Ronnie2K's folder had 3 files matching it in one real month).
  The tiebreak is the exact `total impressions custom metric (sum)` column,
  then most data rows.
- **Never hardcode which "views" column to trust per account.** 2K Brand's
  export has no `Views - Overall custom metric (SUM)` column at all.
  Ronnie2K's export has that column AND relies on it, but also sometimes
  only has `Video Views (SUM)` populated. The rule (`views = CCV if CCV > 0
  else whichever fallback column exists in THIS file's header`) reads the
  actual header every time instead of assuming based on account name — an
  earlier version of this exact fix, ported by name instead of by
  verification, silently cut Ronnie2K's Instagram views in half.
- **`Cross Channel Video Views Lifetime (SUM)` and `Video Views (SUM)` are
  near-duplicates on true video posts.** Summing them roughly doubles the
  real count. Never sum them — pick one.
- **YouTube Studio "Content" export detection is narrow on purpose**
  (`video title` column, or `content` + `duration` together, plus an
  impressions column). A looser "has impressions and something with
  'publish' in the name" check false-matched an unrelated Sprinklr summary
  file (`Volume of Published Messages (SUM)` contains "publish" as a
  substring).
- **Exclude rows with an unparseable/blank date when filtering to a target
  month.** Don't include them by default. The old n8n version did the
  opposite and silently pulled 2 old videos with no publish-date metadata
  into whichever month was current.
- **History lives in `history/*.json`, not a spreadsheet.** No row-index
  arithmetic against a live Sheet, ever — that's what caused a real,
  currently-unresolved data-loss incident in `monthly_stats_ronnie`.
```

**Source:** `.claude/skills/2k-monthly-report/scripts/generate_report.py`

```python
#!/usr/bin/env python3
"""
2K / Ronnie2K Monthly Social Stats — report data builder.

Given a folder of raw Sprinklr (+ optional YouTube Studio) CSV exports, this
script figures out which file is the real post-level export, classifies it
by ACCOUNT (2k vs ronnie2k) from the data itself (not the filename), computes
per-platform totals for the most-common month found in the data, folds in a
YouTube supplemental export if one is present, and merges in local
month-over-month history.

It does NOT render HTML/PDF and does NOT call any AI model — it only produces
numbers. Claude reviews the output, writes the commentary paragraph itself,
and calls render_pdf.py separately.

Usage:
    python3 generate_report.py /path/to/folder/of/csvs

Prints a single JSON object to stdout with:
    account, period, platformData, totals, top3Posts, warnings,
    history_comparison (MoM), and the exact list of files it read/skipped/why.

Design notes (lessons learned building the n8n version of this report):
- Classification of the main export is by CONTENT SIGNATURE, never filename.
  Different Sprinklr accounts have inconsistent filenames and even
  inconsistent COLUMN SETS (2K Brand's export has no
  'Views - Overall custom metric (SUM)' column; Ronnie2K's export has no such
  gap but IS missing 'Total Impressions Custom Metric (SUM)' on some months).
  So every column read is guarded with .get(..., '') and every "which views
  column do I trust" decision is made by checking what's ACTUALLY present in
  THIS file's header, not by hardcoding per-account behavior.
- 'Cross Channel Video Views Lifetime (SUM)' and 'Video Views (SUM)' are
  near-duplicate metrics on true video posts (summing them roughly doubles
  the real count). On non-video posts both are typically 0, and the real
  number lives in whichever fallback column this account's export happens to
  populate ('Views - Overall custom metric (SUM)' or plain 'Video Views (SUM)'
  used as the sole fallback, whichever is present). Rule applied per row:
      views = CCV if CCV > 0 else fallback_col
- Date filtering to the target month EXCLUDES rows with an unparseable/blank
  date, rather than including them by default (the n8n version's original
  behavior — a small accepted bug there; fixed properly here since this is a
  clean rebuild).
"""

import csv
import io
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
               'July', 'August', 'September', 'October', 'November', 'December']
SHORT_MONTHS = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
                'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}

PLATFORM_MAP = {
    'INSTAGRAM': 'Instagram',
    'TWITTER': 'Twitter/X',
    'YOUTUBE': 'YouTube',
    'TIKTOK_BUSINESS': 'TikTok',
    'TIKTOK': 'TikTok',
    'FBPAGE': 'Facebook',
    'FACEBOOK': 'Facebook',
    'THREADS': 'Threads',
}


def to_num(v):
    if v is None or v == '' or v == '-':
        return 0.0
    try:
        return float(re.sub(r'[%,\s]', '', str(v)))
    except ValueError:
        return 0.0


def get_platform(account_type):
    return PLATFORM_MAP.get((account_type or '').upper().strip())


def derive_content_type(media_type_col_value, platform, permalink):
    """Content-type label for the breakdown, using whatever signal this row actually has.
    Never guesses across accounts — an account either has a real 'Media Type' column
    (used as-is) or doesn't (only Instagram gets a permalink-derived fallback, since
    Instagram's own URL structure reliably distinguishes Stories/Reels/feed posts; no
    other platform's permalink format does this reliably, so they get no content-type
    label rather than a fabricated one)."""
    if media_type_col_value:
        return media_type_col_value.strip()
    if platform == 'Instagram' and permalink:
        if '/stories/' in permalink:
            return 'Story'
        if '/reel/' in permalink:
            return 'Reel'
        if '/p/' in permalink:
            return 'Feed Post'
    return None


def parse_date_key(date_str):
    """Parse 'MM-DD-YYYY HH:MM' / 'YYYY-MM-DD ...' style dates -> 'YYYY-MM', or None."""
    if not date_str:
        return None
    parts = re.split(r'[\s\-/]', date_str.strip())
    if len(parts) < 3:
        return None
    try:
        a = int(parts[0])
    except ValueError:
        return None
    if a > 31:
        y, m = a, int(parts[1])
    else:
        m, y = a, int(parts[2])
    if 1 <= m <= 12 and y >= 2020:
        return f"{y}-{m:02d}"
    return None


def parse_yt_studio_date_key(date_str):
    """Parse YouTube Studio's 'Month Day, Year' / 'D-Mon-YY' formats -> 'YYYY-MM', or None."""
    if not date_str:
        return None
    m = re.match(r'([A-Za-z]+)\s+(\d+),?\s+(\d{4})', date_str)
    if m:
        mo = SHORT_MONTHS.get(m.group(1)[:3].lower())
        y = int(m.group(3))
        if mo and y >= 2020:
            return f"{y}-{mo:02d}"
    m = re.match(r'^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$', date_str.strip())
    if m:
        mo = SHORT_MONTHS.get(m.group(2).lower())
        y = int(m.group(3))
        if y < 100:
            y += 2000
        if mo and y >= 2020:
            return f"{y}-{mo:02d}"
    return parse_date_key(date_str)


def read_csv_rows(path):
    """Read a CSV robustly (handles BOM, embedded newlines in quoted fields)."""
    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        text = f.read()
    reader = csv.reader(io.StringIO(text))
    rows = [r for r in reader if any((c or '').strip() for c in r)]
    return rows


def lower_headers(headers):
    return [h.strip().lower() for h in headers]


def classify_main_export(headers_lower):
    """The true post-level export always has these 4 columns, regardless of account.
    NOTE: this signature alone can be ambiguous — some accounts' Drive folders contain a
    second Sprinklr export (e.g. a differently-scoped 'CrossChannelMessageScorecard') that
    also satisfies it. See find_files() for the disambiguation/tiebreak logic."""
    required = {'account type', 'published date', 'total engagements (sum)', 'post reach (sum)'}
    return required.issubset(set(headers_lower))


def classify_yt_studio_export(headers_lower):
    """YouTube Studio 'Content' export: a per-video listing with columns like
    'Content, Video title, Video publish time, Duration, Views, Impressions'.
    Deliberately narrow — must NOT be the Sprinklr main export (no 'account type'), and
    must have a real per-video title/content+duration column, not just any column whose
    name happens to contain 'publish' or 'impressions' as a substring (e.g. Sprinklr's
    'Volume of Published Messages (SUM)' or 'Total Impressions' summary columns, which
    caused false positives here before this was tightened)."""
    if 'account type' in headers_lower:
        return False
    has_video_title = 'video title' in headers_lower
    has_content_and_duration = 'content' in headers_lower and 'duration' in headers_lower
    has_impressions = any('impressions' in h for h in headers_lower)
    return (has_video_title or has_content_and_duration) and has_impressions


def find_files(folder):
    folder = Path(folder)
    csv_files = sorted(folder.glob('*.csv'))
    main_candidates = []  # (path, headers_lower, data_row_count)
    yt_file = None
    skipped = []
    for f in csv_files:
        try:
            rows = read_csv_rows(f)
        except Exception as e:
            skipped.append({'file': f.name, 'reason': f'unreadable: {e}'})
            continue
        if len(rows) < 2:
            skipped.append({'file': f.name, 'reason': 'too few rows'})
            continue
        headers_lower = lower_headers(rows[0])
        if classify_main_export(headers_lower):
            main_candidates.append((f, headers_lower, len(rows) - 1))
            continue
        if yt_file is None and classify_yt_studio_export(headers_lower):
            yt_file = f
            continue
        skipped.append({'file': f.name, 'reason': 'not main export or YouTube Studio export (ignored)'})

    main_file = None
    impressions_join_file = None
    if main_candidates:
        if len(main_candidates) > 1:
            # Disambiguate. Two competing signals, and neither one wins outright:
            #   1. The candidate with the EXACT 'Total Impressions Custom Metric (SUM)' column
            #      is usually the intended canonical export (verified against Ronnie2K's real
            #      account, where the impressions-carrying file and the runner-up have nearly
            #      identical row counts — 961 vs 962 — so preferring it costs nothing).
            #   2. But on 2K Brand's account, the impressions-carrying file turned out to only
            #      cover 85 of ~259 real July rows — a materially incomplete export, not a
            #      genuine alternative. Picking it as the PRIMARY source would silently drop
            #      real posts from views/engagements/reach.
            # Resolution: only let the impressions-column candidate win outright if its row
            # count is close (>=90%) to the best-covered candidate. Otherwise, the best-covered
            # candidate becomes primary, and the impressions-column candidate is demoted to a
            # permalink-matched enrichment source (see build_impressions_join) instead of being
            # discarded — real impressions data is too useful to throw away over a coverage gap.
            with_impressions_col = [c for c in main_candidates
                                     if 'total impressions custom metric (sum)' in c[1]]
            by_rows = sorted(main_candidates, key=lambda c: -c[2])
            best_coverage = by_rows[0]
            chosen = best_coverage
            if with_impressions_col:
                best_impressions_candidate = max(with_impressions_col, key=lambda c: c[2])
                if best_impressions_candidate[2] >= 0.9 * best_coverage[2]:
                    chosen = best_impressions_candidate
                elif best_impressions_candidate[0] != best_coverage[0]:
                    impressions_join_file = best_impressions_candidate[0]
            main_file = chosen[0]
            for f, _, _ in main_candidates:
                if f != main_file and f != impressions_join_file:
                    skipped.append({'file': f.name,
                                     'reason': 'also matched the main-export signature but was not chosen '
                                               '(ambiguous — see main_export_candidates in output)'})
        else:
            main_file = main_candidates[0][0]

    return main_file, yt_file, skipped, [c[0].name for c in main_candidates], impressions_join_file


def build_impressions_join(path, target_key):
    """Read a secondary Exportforn8nreports-style file and build a Permalink -> impressions
    lookup for the target month only. Exists because 2K Brand's primary (best-covered) export
    type never carries 'Total Impressions Custom Metric (SUM)' at all, but a *different* export
    type from the same account, for the same real posts (verified: permalinks matched 73/73),
    does — just with worse post coverage overall. Rather than trusting that file's own
    views/engagements (which drift from the primary file's, likely due to 'lifetime' metrics
    being measured at a different export timestamp), we only ever pull impressions out of it,
    keyed by the one field that's guaranteed to identify the same real post: Permalink."""
    try:
        rows = read_csv_rows(path)
    except Exception:
        return {}
    if len(rows) < 2:
        return {}
    headers = [h.strip() for h in rows[0]]
    headers_lower = [h.lower() for h in headers]
    if 'total impressions custom metric (sum)' not in headers_lower:
        return {}
    col_idx = {h: i for i, h in enumerate(headers)}

    def get(row, name):
        idx = col_idx.get(name)
        return row[idx] if idx is not None and idx < len(row) else ''

    lookup = {}
    for row in rows[1:]:
        permalink = get(row, 'Permalink')
        if not permalink:
            continue
        if target_key:
            row_key = parse_date_key(get(row, 'Published Date'))
            if row_key != target_key:
                continue
        imp = to_num(get(row, 'Total Impressions Custom Metric (SUM)'))
        if imp > 0:
            lookup[permalink] = lookup.get(permalink, 0.0) + imp
    return lookup


def compute_main(main_path, impressions_join_path=None):
    rows = read_csv_rows(main_path)
    headers = [h.strip() for h in rows[0]]
    headers_lower = [h.lower() for h in headers]
    data_rows = rows[1:]
    col_idx = {h: i for i, h in enumerate(headers)}

    def get(row, col_name):
        idx = col_idx.get(col_name)
        if idx is None or idx >= len(row):
            return ''
        return row[idx]

    # Auto-detect which column carries "views" for non-video posts on THIS account's export.
    # Never hardcode this per account name — different Sprinklr accounts populate different
    # columns (verified: 2K Brand only populates 'Views - Overall custom metric (SUM)';
    # Ronnie2K's export doesn't have that column at all and only populates 'Video Views (SUM)').
    if 'views - overall custom metric (sum)' in headers_lower:
        fallback_col = headers[headers_lower.index('views - overall custom metric (sum)')]
    elif 'video views (sum)' in headers_lower:
        fallback_col = headers[headers_lower.index('video views (sum)')]
    else:
        fallback_col = None

    # Account name (for branding/history) — majority value of the 'Account' column, if present.
    account_counts = defaultdict(int)
    if 'account' in headers_lower:
        acc_col = headers[headers_lower.index('account')]
        for row in data_rows:
            v = (get(row, acc_col) or '').strip()
            if v:
                account_counts[v.lower()] += 1
    account = max(account_counts, key=account_counts.get) if account_counts else 'unknown'

    # Period: most-common month found in Published Date.
    date_freq = defaultdict(int)
    for row in data_rows:
        key = parse_date_key(get(row, 'Published Date'))
        if key:
            date_freq[key] += 1
    target_key = max(date_freq, key=date_freq.get) if date_freq else None
    if target_key:
        y, m = target_key.split('-')
        period = f"{MONTH_NAMES[int(m) - 1]} {y}"
    else:
        period = 'Unknown Period'

    has_media_type_col = 'media type' in headers_lower
    media_type_col = headers[headers_lower.index('media type')] if has_media_type_col else None

    impressions_join = build_impressions_join(impressions_join_path, target_key) if impressions_join_path else {}
    joined_permalinks_used = set()

    platform_data = {}
    all_posts = []
    content_type_breakdown = defaultdict(lambda: defaultdict(
        lambda: {'total_views': 0.0, 'total_engagements': 0.0, 'post_count': 0}))
    skipped_rows_wrong_month = 0

    for row in data_rows:
        account_type = get(row, 'Account Type')
        if not account_type:
            continue
        platform = get_platform(account_type)
        if not platform:
            continue
        if target_key:
            row_key = parse_date_key(get(row, 'Published Date'))
            if row_key != target_key:
                skipped_rows_wrong_month += 1
                continue

        ccv = to_num(get(row, 'Cross Channel Video Views Lifetime (SUM)'))
        fallback_views = to_num(get(row, fallback_col)) if fallback_col else 0.0
        views = ccv if ccv > 0 else fallback_views
        engagements = to_num(get(row, 'Total Engagements (SUM)'))
        reach = to_num(get(row, 'Post Reach (SUM)'))
        impressions = to_num(get(row, 'Total Impressions Custom Metric (SUM)'))
        eng_rate = to_num(get(row, 'Engagement Rate in %')) / 100
        permalink = get(row, 'Permalink') or get(row, 'Post URL') or get(row, 'URL') or ''

        # Backfill impressions from the join file, once per unique permalink — never per row,
        # since duplicate rows sharing a permalink (reply/DM interactions logged against the
        # parent post, see SKILL.md) would otherwise multiply a single post's impressions by
        # however many duplicate rows it has.
        if impressions == 0 and permalink and permalink in impressions_join and permalink not in joined_permalinks_used:
            impressions = impressions_join[permalink]
            joined_permalinks_used.add(permalink)

        d = platform_data.setdefault(platform, {
            'platform': platform, 'total_views': 0.0, 'total_engagements': 0.0,
            'total_impressions': 0.0, 'total_reach': 0.0, 'post_count': 0, '_eng_rates': []
        })
        d['total_views'] += views
        d['total_engagements'] += engagements
        d['total_impressions'] += impressions
        d['total_reach'] += reach
        d['post_count'] += 1
        if eng_rate > 0:
            d['_eng_rates'].append(eng_rate)

        content_type = derive_content_type(
            get(row, media_type_col) if media_type_col else None, platform, permalink)
        if content_type:
            ct = content_type_breakdown[platform][content_type]
            ct['total_views'] += views
            ct['total_engagements'] += engagements
            ct['post_count'] += 1

        all_posts.append({
            'platform': platform,
            'engagements': engagements,
            'url': permalink,
            'published_date': get(row, 'Published Date') or '',
        })

    for d in platform_data.values():
        rates = d.pop('_eng_rates')
        d['avg_engagement_rate'] = (sum(rates) / len(rates)) if rates else (
            d['total_engagements'] / d['total_impressions'] if d['total_impressions'] > 0 else 0
        )

    # Convert to plain dicts and note, per platform, whether a content-type signal existed at
    # all (a platform with zero entries here has NO reliable content-type data in this export —
    # say so explicitly rather than letting it look identical to "no video/photo posts").
    content_type_breakdown = {p: dict(v) for p, v in content_type_breakdown.items()}
    platforms_without_content_type_signal = [
        p for p in platform_data if p not in content_type_breakdown
    ]

    top3 = sorted([p for p in all_posts if p['engagements'] > 0],
                  key=lambda p: -p['engagements'])[:3]

    return {
        'account': account,
        'period': period,
        'target_key': target_key,
        'platform_data': platform_data,
        'top3_posts': top3,
        'views_fallback_column_used': fallback_col,
        'rows_total': len(data_rows),
        'rows_skipped_wrong_month': skipped_rows_wrong_month,
        'months_found_in_file': dict(date_freq),
        'content_type_breakdown': content_type_breakdown,
        'content_type_source': ('Media Type column in main export' if has_media_type_col
                                 else 'Instagram permalink pattern only (no Media Type column in this export)'),
        'platforms_without_content_type_signal': platforms_without_content_type_signal,
        'impressions_join_file': Path(impressions_join_path).name if impressions_join_path else None,
        'impressions_join_permalinks_available': len(impressions_join),
        'impressions_join_permalinks_matched': len(joined_permalinks_used),
    }


def compute_youtube_supplemental(yt_path, target_key):
    rows = read_csv_rows(yt_path)
    # Find header row (first row mentioning impressions + a publish/date-like column).
    header_idx = None
    for i, row in enumerate(rows[:10]):
        row_str = ','.join(row).lower()
        if 'impressions' in row_str and ('publish' in row_str or 'date' in row_str or 'likes' in row_str):
            header_idx = i
            break
    if header_idx is None:
        return None

    headers = [h.strip().lower() for h in rows[header_idx]]
    data_rows = rows[header_idx + 1:]
    col_idx = {h: i for i, h in enumerate(headers)}

    def get(row, *names):
        for name in names:
            idx = col_idx.get(name.lower())
            if idx is not None and idx < len(row):
                return row[idx]
        return ''

    total_views = total_impressions = total_engagements = 0.0
    post_count = 0
    excluded_no_date = 0

    for row in data_rows:
        if len(row) < 3 or all(not (c or '').strip() for c in row):
            continue
        if (row[0] or '').strip().lower() == 'total':
            continue
        date_str = get(row, 'Video publish time', 'Post publish time', 'Published', 'Post date', 'Date', 'Published date')
        row_key = parse_yt_studio_date_key(date_str)
        if target_key:
            if row_key is None:
                # Unlike the earlier n8n version, an unparseable date here is EXCLUDED,
                # not included by default — fixed properly in this clean rebuild.
                excluded_no_date += 1
                continue
            if row_key != target_key:
                continue

        impressions = to_num(get(row, 'Post impressions', 'Impressions'))
        views = to_num(get(row, 'Views', 'Video views'))
        likes = to_num(get(row, 'Post likes', 'Likes', 'Like count'))
        comments = to_num(get(row, 'Comments', 'Post comments', 'Comment count'))
        dislikes = to_num(get(row, 'Dislikes', 'Post dislikes', 'Dislike estimate', 'Dislike count'))

        total_impressions += impressions
        total_views += views
        total_engagements += likes + comments + dislikes
        post_count += 1

    return {
        'platform': 'YouTube Community',
        'total_views': total_views,
        'total_engagements': total_engagements,
        'total_impressions': total_impressions,
        'total_reach': 0.0,
        'post_count': post_count,
        'avg_engagement_rate': (total_engagements / total_impressions) if total_impressions > 0 else 0,
        'rows_excluded_unparseable_date': excluded_no_date,
    }


def history_path_for(account, skill_dir):
    slug = 'ronnie2k' if 'ronnie' in account else '2k_brand'
    return Path(skill_dir) / 'history' / f'{slug}_history.json'


def load_history(account, skill_dir):
    p = history_path_for(account, skill_dir)
    if p.exists():
        return json.loads(p.read_text())
    return []


def save_history(account, skill_dir, entries):
    p = history_path_for(account, skill_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(entries, indent=2))


def month_shift(period, delta_years=0, delta_months=0):
    name, year = period.split(' ')
    idx = MONTH_NAMES.index(name)
    total = idx + delta_months
    year = int(year) + delta_years + total // 12
    idx = total % 12
    return f"{MONTH_NAMES[idx]} {year}"


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'usage: generate_report.py /path/to/csv/folder [--commit]'}))
        sys.exit(1)

    folder = sys.argv[1]
    commit = '--commit' in sys.argv[2:]
    skill_dir = Path(__file__).resolve().parent.parent

    main_file, yt_file, skipped, main_candidates, impressions_join_file = find_files(folder)
    if not main_file:
        print(json.dumps({'error': 'No main export CSV found (need a CSV with Account Type, '
                                    'Published Date, Total Engagements (SUM), Post Reach (SUM) columns).',
                           'skipped_files': skipped}))
        sys.exit(1)

    result = compute_main(main_file, impressions_join_path=impressions_join_file)
    result['main_file'] = main_file.name
    result['main_export_candidates'] = main_candidates

    if yt_file:
        yt_result = compute_youtube_supplemental(yt_file, result['target_key'])
        if yt_result:
            result['platform_data']['YouTube Community'] = yt_result
        result['yt_file'] = yt_file.name
    else:
        result['yt_file'] = None

    totals = {
        'total_views': sum(d['total_views'] for d in result['platform_data'].values()),
        'total_engagements': sum(d['total_engagements'] for d in result['platform_data'].values()),
        'total_impressions': sum(d['total_impressions'] for d in result['platform_data'].values()),
        'total_reach': sum(d['total_reach'] for d in result['platform_data'].values()),
        'post_count': sum(d['post_count'] for d in result['platform_data'].values()),
    }
    result['totals'] = totals

    # --- History / MoM ---
    history = load_history(result['account'], skill_dir)
    existing_for_period = [h for h in history if h['period'] == result['period']]
    prev_period = month_shift(result['period'], delta_months=-1)
    yoy_period = month_shift(result['period'], delta_years=-1)

    def totals_for(period):
        rows = [h for h in history if h['period'] == period]
        if not rows:
            return None
        return {
            'total_views': sum(r['total_views'] for r in rows),
            'total_engagements': sum(r['total_engagements'] for r in rows),
            'total_impressions': sum(r['total_impressions'] for r in rows),
            'total_reach': sum(r['total_reach'] for r in rows),
        }

    def platform_history(platform, period):
        for r in history:
            if r['period'] == period and r['platform'] == platform:
                return r
        return None

    comparisons = {}
    for platform, d in result['platform_data'].items():
        mom = platform_history(platform, prev_period)
        yoy = platform_history(platform, yoy_period)
        comparisons[platform] = {'mom': mom, 'yoy': yoy}

    result['history'] = {
        'already_recorded_for_this_period': len(existing_for_period) > 0,
        'existing_rows_for_this_period': existing_for_period,
        'prev_period': prev_period,
        'prev_period_totals': totals_for(prev_period),
        'yoy_period': yoy_period,
        'yoy_period_totals': totals_for(yoy_period),
        'per_platform_comparison': comparisons,
    }
    result['skipped_files'] = skipped

    # Clean up platform_data for JSON output (drop internal helper keys, round numbers)
    clean_platform_data = {}
    for platform, d in result['platform_data'].items():
        clean_platform_data[platform] = {k: v for k, v in d.items() if not k.startswith('_')}
    result['platform_data'] = clean_platform_data

    if commit:
        if result['history']['already_recorded_for_this_period']:
            result['commit_status'] = (
                f"SKIPPED writing to history: {result['period']} is already recorded "
                f"({len(existing_for_period)} rows). Remove those entries from "
                f"{history_path_for(result['account'], skill_dir)} first if you want to overwrite."
            )
        else:
            now_iso = __import__('datetime').datetime.utcnow().isoformat() + 'Z'
            new_rows = [
                {'period': result['period'], 'platform': platform, 'recorded_at': now_iso,
                 **{k: v for k, v in d.items() if k in
                    ('total_views', 'total_engagements', 'total_impressions', 'total_reach',
                     'post_count', 'avg_engagement_rate')}}
                for platform, d in clean_platform_data.items()
            ]
            history.extend(new_rows)
            save_history(result['account'], skill_dir, history)
            result['commit_status'] = (
                f"Wrote {len(new_rows)} rows to "
                f"{history_path_for(result['account'], skill_dir)}"
            )

    print(json.dumps(result, indent=2, default=str))


if __name__ == '__main__':
    main()
```

**Source:** `.claude/skills/2k-monthly-report/scripts/render_pdf.py`

```python
#!/usr/bin/env python3
"""
Render a monthly social stats report (the JSON produced by generate_report.py,
plus a commentary paragraph Claude writes separately) into a branded PDF.

Usage:
    python3 render_pdf.py report_data.json commentary.txt output.pdf

report_data.json: the exact JSON generate_report.py printed to stdout.
commentary.txt:   a plain-text file with the analysis paragraph(s) (Claude
                   writes this itself — no AI API call happens in this script).
output.pdf:       where to write the PDF.

Uses Playwright + a real browser (Chrome if available, else bundled Chromium)
to render the HTML and print it to PDF — no wkhtmltopdf/weasyprint dependency.
"""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BRAND = {
    # 2K: red-heavy (matches the original brand identity — red header/table/badges,
    # navy tiles, teal accent numbers).
    '2k': {
        'name': '2K', 'title': '2K',
        'header_bg': '#E61F27', 'table_header_bg': '#E61F27',
        'tile_bg': '#051A3A', 'accent': '#16EECE',
        'period_badge_bg': '#051A3A', 'period_badge_text': '#FFFFFF',
        'post_badge_bg': '#E61F27', 'post_badge_text': '#FFFFFF',
        'platform_tag_bg': '#051A3A', 'platform_tag_text': '#16EECE',
        'commentary_border': '#E61F27', 'link_color': '#E61F27',
    },
    # Ronnie2K: dark blue-heavy (deep blue everywhere 2K uses red, teal as the only
    # pop of contrast — no red at all, deliberately distinct from the 2K brand report).
    'ronnie2k': {
        'name': 'RONNIE2K', 'title': 'RONNIE2K',
        'header_bg': '#0B2A6B', 'table_header_bg': '#0B2A6B',
        # accent went teal -> black (illegible, 1.56:1) -> red #E61F27 (failed contrast at
        # 2.95:1) -> coral #FF6B5B (passed contrast at 4.82:1, but Ben flagged it as reading
        # like "this number is decreasing" since it sits right above the red/green MoM arrows,
        # where red genuinely does mean down). White has zero directional connotation, keeps
        # red/green meaningful ONLY on the actual delta arrows, and has the best contrast of
        # anything tried (13.48:1 against #0B2A6B). Don't reintroduce red/black here again
        # without re-reading this note.
        'tile_bg': '#0B2A6B', 'accent': '#FFFFFF',
        'period_badge_bg': '#16EECE', 'period_badge_text': '#051A3A',
        'post_badge_bg': '#16EECE', 'post_badge_text': '#051A3A',
        'platform_tag_bg': '#0B2A6B', 'platform_tag_text': '#16EECE',
        'commentary_border': '#16EECE', 'link_color': '#16EECE',
    },
}
PLATFORM_TIER = {
    # Confirmed by Ben 2026-08-04: these are each account's actual focus platforms.
    # Primary platforms are listed first in the breakdown table, in this order;
    # secondary platforms follow below a divider row, in this order. Anything not
    # listed here (a platform that shows up unexpectedly) is treated as secondary
    # and sorted after the named secondary platforms, so a new/unknown platform
    # never silently outranks the ones Ben actually said matter.
    '2k': {
        'primary': ['Instagram', 'TikTok', 'Twitter/X'],
        'secondary': ['YouTube Community', 'YouTube', 'Facebook'],
    },
    'ronnie2k': {
        'primary': ['Instagram', 'Twitter/X', 'TikTok'],
        'secondary': ['YouTube', 'Facebook', 'Threads'],
    },
}


def sort_platforms(platforms, account):
    tier = PLATFORM_TIER.get(account, {'primary': [], 'secondary': []})
    primary_order = {p: i for i, p in enumerate(tier['primary'])}
    secondary_order = {p: i for i, p in enumerate(tier['secondary'])}

    def rank(p):
        name = p['platform']
        if name in primary_order:
            return (0, primary_order[name])
        if name in secondary_order:
            return (1, secondary_order[name])
        return (1, len(secondary_order))  # unknown platform -> end of secondary group

    ordered = sorted(platforms, key=rank)
    split_idx = sum(1 for p in ordered if rank(p)[0] == 0)
    return ordered[:split_idx], ordered[split_idx:]


DEFAULT_BRAND = {
    'name': 'REPORT', 'title': 'REPORT',
    'header_bg': '#051A3A', 'table_header_bg': '#051A3A',
    'tile_bg': '#051A3A', 'accent': '#16EECE',
    'period_badge_bg': '#16EECE', 'period_badge_text': '#051A3A',
    'post_badge_bg': '#16EECE', 'post_badge_text': '#051A3A',
    'platform_tag_bg': '#051A3A', 'platform_tag_text': '#16EECE',
    'commentary_border': '#16EECE', 'link_color': '#16EECE',
}


def fmt_num(n):
    n = float(n or 0)
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(round(n))


def fmt_pct(n):
    return f"{n * 100:.2f}%"


def pct_change(curr, prev):
    if not prev:
        return None
    return round(((curr - prev) / prev) * 1000) / 10


def fmt_delta(pct):
    if pct is None:
        return 'N/A'
    arrow = '▲' if pct >= 0 else '▼'
    return f"{arrow}{abs(pct)}%"


def build_html(data, commentary_html):
    from datetime import datetime, timezone
    generated_at = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    account = (data.get('account') or '').lower()
    brand = dict(DEFAULT_BRAND)
    brand.update(BRAND.get(account, {'name': account.upper() or 'REPORT', 'title': account.upper() or 'REPORT'}))
    period = data['period']
    totals = data['totals']
    platforms = list(data['platform_data'].values())
    top3 = data.get('top3_posts', [])
    history = data.get('history', {})
    comparisons = history.get('per_platform_comparison', {})
    prev_period = history.get('prev_period', '')
    prev_totals = history.get('prev_period_totals')

    def mom_for(platform, field):
        c = comparisons.get(platform, {}).get('mom')
        if not c:
            return None
        return pct_change(float(platform_row(platform)[field]), float(c.get(field, 0)))

    def platform_row(platform):
        return next(p for p in platforms if p['platform'] == platform)

    totals_mom = None
    if prev_totals:
        totals_mom = {
            'views': fmt_delta(pct_change(totals['total_views'], prev_totals['total_views'])),
            'engagements': fmt_delta(pct_change(totals['total_engagements'], prev_totals['total_engagements'])),
            'impressions': fmt_delta(pct_change(totals['total_impressions'], prev_totals['total_impressions'])),
            'reach': fmt_delta(pct_change(totals['total_reach'], prev_totals['total_reach'])),
        }

    def tile_mom(key):
        if not totals_mom:
            return ''
        v = totals_mom[key]
        if v == 'N/A':
            return ''
        color = '#4ade80' if v.startswith('▲') else '#f87171'
        return f'<div style="font-size:11px;font-weight:700;margin-top:6px;color:{color}">{v} MoM</div>'

    def view_post_link(post):
        if not post.get('url'):
            return ''
        style = ("font-family:'Montserrat',Arial,sans-serif;font-size:10px;font-weight:700;"
                 f"color:{brand['link_color']};letter-spacing:1px;text-decoration:none")
        return f'<a href="{post["url"]}" style="{style}">VIEW POST &#8594;</a>'

    top3_html = ''
    if top3:
        cards = []
        for idx, post in enumerate(top3):
            cards.append(f'''<td valign="top"{'' if idx == len(top3) - 1 else ' style="padding-right:8px"'}>
              <div style="width:100%;height:120px;background:#e8eaf0;border-radius:6px;margin-bottom:10px"></div>
              <table cellpadding="0" cellspacing="0" style="margin-bottom:8px"><tr>
                <td style="background:{brand['post_badge_bg']};border-radius:3px;padding:2px 7px;font-family:'Montserrat',Arial,sans-serif;font-size:10px;font-weight:800;color:{brand['post_badge_text']};letter-spacing:1px">#{idx + 1}</td>
                <td width="4"></td>
                <td style="background:{brand['platform_tag_bg']};border-radius:3px;padding:2px 7px;font-family:'Montserrat',Arial,sans-serif;font-size:10px;font-weight:700;color:{brand['platform_tag_text']};letter-spacing:1px">{post['platform'].upper()}</td>
              </tr></table>
              <div style="font-family:'Montserrat',Arial,sans-serif;font-size:22px;font-weight:900;color:#051A3A;line-height:1">{fmt_num(post['engagements'])}</div>
              <div style="font-family:'Montserrat',Arial,sans-serif;font-size:10px;color:#6b6b6b;letter-spacing:1px;margin-top:2px;margin-bottom:6px">ENGAGEMENTS</div>
              {view_post_link(post)}
            </td>''')
        row_cells = []
        for i, c in enumerate(cards):
            row_cells.append(c)
            if i < len(cards) - 1:
                row_cells.append('<td width="8"></td>')
        top3_html = f'''
        <h2 style="font-family:'Montserrat',Arial,sans-serif;color:#051A3A;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px">TOP 3 POSTS OF THE MONTH</h2>
        <div style="height:2px;background:#051A3A;margin-bottom:20px"></div>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
          <tr>{"".join(row_cells)}</tr>
        </table>'''

    def platform_row_html(p):
        eng_rate = p.get('avg_engagement_rate') or 0
        mom_views = mom_for(p['platform'], 'total_views')
        mom_eng = mom_for(p['platform'], 'total_engagements')
        mom_views_html = f'<div style="font-size:10px;font-weight:700;color:{"#16a34a" if (mom_views or 0) >= 0 else "#dc2626"}">{fmt_delta(mom_views)}</div>' if mom_views is not None else ''
        mom_eng_html = f'<div style="font-size:10px;font-weight:700;color:{"#16a34a" if (mom_eng or 0) >= 0 else "#dc2626"}">{fmt_delta(mom_eng)}</div>' if mom_eng is not None else ''
        return f'''
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e8eaf0;font-family:'Montserrat',Arial,sans-serif;font-weight:600;font-size:13px;color:#051A3A">{p['platform']}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e8eaf0;text-align:right;font-family:'Montserrat',Arial,sans-serif;font-size:13px;color:#333">{fmt_num(p['total_views'])}{mom_views_html}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e8eaf0;text-align:right;font-family:'Montserrat',Arial,sans-serif;font-size:13px;color:#333">{fmt_num(p['total_engagements'])}{mom_eng_html}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e8eaf0;text-align:right;font-family:'Montserrat',Arial,sans-serif;font-size:13px;color:#333">{fmt_pct(eng_rate)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e8eaf0;text-align:right;font-family:'Montserrat',Arial,sans-serif;font-size:13px;color:#333">{fmt_num(p['total_impressions'])}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e8eaf0;text-align:right;font-family:'Montserrat',Arial,sans-serif;font-size:13px;color:#333">{fmt_num(p['total_reach'])}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e8eaf0;text-align:right;font-family:'Montserrat',Arial,sans-serif;font-size:13px;color:#333">{p['post_count']}</td>
        </tr>'''

    primary_platforms, secondary_platforms = sort_platforms(platforms, account)
    platform_rows = ''.join(platform_row_html(p) for p in primary_platforms)
    if secondary_platforms:
        platform_rows += f'''
        <tr><td colspan="7" style="padding:8px 12px;background:#f7f8fa;font-family:'Montserrat',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1px;color:#6b6b6b;border-bottom:1px solid #e8eaf0">SECONDARY PLATFORMS</td></tr>'''
        platform_rows += ''.join(platform_row_html(p) for p in secondary_platforms)

    html = f'''<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>{brand["title"]} Social Stats — {period}</title></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Montserrat',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:32px 0">
<tr><td align="center">
<table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08)">

  <tr><td style="background:{brand['header_bg']};padding:28px 36px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <div style="font-family:'Montserrat',Arial,sans-serif;font-size:32px;font-weight:900;color:#FFFFFF;letter-spacing:3px">{brand["name"]}</div>
        <div style="font-family:'Montserrat',Arial,sans-serif;font-size:10px;font-weight:500;color:rgba(255,255,255,0.8);letter-spacing:3px;margin-top:4px;text-transform:uppercase">MONTHLY SOCIAL MEDIA PERFORMANCE REPORT</div>
      </td>
      <td align="right">
        <div style="background:{brand['period_badge_bg']};color:{brand['period_badge_text']};font-family:'Montserrat',Arial,sans-serif;font-size:15px;font-weight:700;padding:10px 20px;border-radius:4px;letter-spacing:1px">{period}</div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:32px 36px">

    {top3_html}

    <h2 style="font-family:'Montserrat',Arial,sans-serif;color:#051A3A;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px">CROSS-PLATFORM SUMMARY</h2>
    <div style="height:2px;background:#051A3A;margin-bottom:20px"></div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px"><tr>
      <td align="center" style="background:{brand['tile_bg']};padding:20px;border-radius:6px;width:25%">
        <div style="font-family:'Montserrat',Arial,sans-serif;font-size:26px;font-weight:900;color:{brand['accent']}">{fmt_num(totals['total_views'])}</div>
        <div style="font-family:'Montserrat',Arial,sans-serif;font-size:10px;font-weight:500;color:#ffffff;letter-spacing:2px;margin-top:4px">TOTAL VIEWS</div>{tile_mom('views')}
      </td><td width="8"></td>
      <td align="center" style="background:{brand['tile_bg']};padding:20px;border-radius:6px;width:25%">
        <div style="font-family:'Montserrat',Arial,sans-serif;font-size:26px;font-weight:900;color:{brand['accent']}">{fmt_num(totals['total_engagements'])}</div>
        <div style="font-family:'Montserrat',Arial,sans-serif;font-size:10px;font-weight:500;color:#ffffff;letter-spacing:2px;margin-top:4px">TOTAL ENGAGEMENTS</div>{tile_mom('engagements')}
      </td><td width="8"></td>
      <td align="center" style="background:{brand['tile_bg']};padding:20px;border-radius:6px;width:25%">
        <div style="font-family:'Montserrat',Arial,sans-serif;font-size:26px;font-weight:900;color:{brand['accent']}">{fmt_num(totals['total_impressions'])}</div>
        <div style="font-family:'Montserrat',Arial,sans-serif;font-size:10px;font-weight:500;color:#ffffff;letter-spacing:2px;margin-top:4px">TOTAL IMPRESSIONS</div>{tile_mom('impressions')}
      </td><td width="8"></td>
      <td align="center" style="background:{brand['tile_bg']};padding:20px;border-radius:6px;width:25%">
        <div style="font-family:'Montserrat',Arial,sans-serif;font-size:26px;font-weight:900;color:{brand['accent']}">{fmt_num(totals['total_reach'])}</div>
        <div style="font-family:'Montserrat',Arial,sans-serif;font-size:10px;font-weight:500;color:#ffffff;letter-spacing:2px;margin-top:4px">TOTAL REACH</div>{tile_mom('reach')}
      </td>
    </tr></table>

    <h2 style="font-family:'Montserrat',Arial,sans-serif;color:#051A3A;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px">PLATFORM BREAKDOWN</h2>
    <div style="height:2px;background:#051A3A;margin-bottom:16px"></div>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-family:'Montserrat',Arial,sans-serif;font-size:13px;margin-bottom:28px">
      <thead><tr style="background:{brand['table_header_bg']}">
        <th style="padding:10px 12px;text-align:left;color:#FFFFFF;font-size:11px;font-weight:600;letter-spacing:1px">PLATFORM</th>
        <th style="padding:10px 12px;text-align:right;color:#FFFFFF;font-size:11px;font-weight:600;letter-spacing:1px">VIEWS</th>
        <th style="padding:10px 12px;text-align:right;color:#FFFFFF;font-size:11px;font-weight:600;letter-spacing:1px">ENGAGEMENTS</th>
        <th style="padding:10px 12px;text-align:right;color:#FFFFFF;font-size:11px;font-weight:600;letter-spacing:1px">AVG. ENG. RATE</th>
        <th style="padding:10px 12px;text-align:right;color:#FFFFFF;font-size:11px;font-weight:600;letter-spacing:1px">IMPRESSIONS</th>
        <th style="padding:10px 12px;text-align:right;color:#FFFFFF;font-size:11px;font-weight:600;letter-spacing:1px">REACH</th>
        <th style="padding:10px 12px;text-align:right;color:#FFFFFF;font-size:11px;font-weight:600;letter-spacing:1px">POSTS</th>
      </tr></thead>
      <tbody>
        {platform_rows}
        <tr style="background:{brand['tile_bg']}">
          <td style="padding:10px 12px;font-weight:700;color:{brand['accent']};font-size:11px;letter-spacing:1px">ALL PLATFORMS</td>
          <td style="padding:10px 12px;text-align:right;color:#ffffff;font-weight:700">{fmt_num(totals['total_views'])}</td>
          <td style="padding:10px 12px;text-align:right;color:#ffffff;font-weight:700">{fmt_num(totals['total_engagements'])}</td>
          <td style="padding:10px 12px;text-align:right;color:#ffffff;font-weight:700">—</td>
          <td style="padding:10px 12px;text-align:right;color:#ffffff;font-weight:700">{fmt_num(totals['total_impressions'])}</td>
          <td style="padding:10px 12px;text-align:right;color:#ffffff;font-weight:700">{fmt_num(totals['total_reach'])}</td>
          <td style="padding:10px 12px;text-align:right;color:#ffffff;font-weight:700">{totals['post_count']}</td>
        </tr>
      </tbody>
    </table>

    <h2 style="font-family:'Montserrat',Arial,sans-serif;color:#051A3A;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:32px 0 8px">ANALYSIS &amp; COMMENTARY</h2>
    <div style="height:2px;background:#051A3A;margin-bottom:16px"></div>
    <div style="border-left:4px solid {brand['commentary_border']};padding:16px 20px;background:#fafafa;border-radius:0 4px 4px 0;font-family:'Montserrat',Arial,sans-serif;font-size:15px;font-weight:400;color:#333;line-height:1.7">
      {commentary_html}
    </div>

  </td></tr>

  <tr><td style="background:{brand['tile_bg']};padding:20px 36px;text-align:center">
    <div style="font-family:'Montserrat',Arial,sans-serif;font-size:10px;font-weight:400;color:#999;letter-spacing:1px">
      GENERATED {generated_at} VIA THE 2K-MONTHLY-REPORT CLAUDE SKILL &nbsp;·&nbsp; DATA SOURCED FROM SPRINKLR
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>'''
    return html


def main():
    if len(sys.argv) != 4:
        print('usage: render_pdf.py report_data.json commentary.txt output.pdf', file=sys.stderr)
        sys.exit(1)

    data_path, commentary_path, output_path = sys.argv[1:4]
    data = json.loads(Path(data_path).read_text())
    commentary_text = Path(commentary_path).read_text().strip()
    commentary_html = ''.join(f'<p style="margin:0 0 12px 0">{p}</p>' for p in commentary_text.split('\\n\\n') if p.strip())

    html = build_html(data, commentary_html)

    html_debug_path = Path(output_path).with_suffix('.debug.html')
    html_debug_path.write_text(html)

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel='chrome', headless=True)
        except Exception:
            browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(html, wait_until='load')
        page.pdf(path=output_path, width='800px', print_background=True, margin={
            'top': '0px', 'bottom': '0px', 'left': '0px', 'right': '0px'
        })
        browser.close()

    print(f'Wrote {output_path}')


if __name__ == '__main__':
    main()
```

---

## 3. Hook Generator

**Source:** `.claude/skills/2k-hook/SKILL.md`

```markdown
---
name: 2k-hook
description: Write scroll-stopping opening lines (hooks) for Ronnie2K / 2K video and social content. Use when the user says "write a hook," "2k hook," "give me hook options," "cold open," "opening line," "intro for this video," "first few seconds," "scroll stopper," or wants alternatives for the first 1–3 sentences of a VO script, YouTube video, Short, Reel, TikTok, or caption. Combines the YouTube retention hook frameworks with the Evo Nexus social hook patterns, tuned to the Ronnie2K brand voice.
metadata:
  version: 1.1.0
---

# 2K Hook Writer

Generate a menu of hook options — the first 1–3 sentences — for any Ronnie2K / 2K video or post. Built from two sources, merged and tuned to Ronnie's voice:

- **YouTube retention hooks** — five psychological mechanisms, rated for video drop-off.
- **Evo Nexus social hooks** — nine text-post patterns (contrarian, question, story, statistic, list-preview, bold claim, empathy, before/after, confession).

This skill writes openers only. For the full script, use `2k-ronnie2k-copy-style` and `2k-elevenlabs-vo-guide`.

---

## When to Use

User says: "write a hook," "2k hook," "give me hook options," "cold open," "opening line," "first few seconds," "intro for this," "scroll stopper," or asks to rework the first few sentences of a script/video/caption.

---

## Why the Hook Is Everything

| Fact | Implication |
|---|---|
| 20% of viewers leave in the first 10 seconds | The opener is the single highest-leverage line you write. |
| 55% leave in the first 60 seconds | If the hook doesn't deliver the promise fast, the rest never gets seen. |
| Auto-play era: first 5 sec = extension of the thumbnail | The video is already playing on Home. The open has to keep them there, not "warm up." |
| Suspension-bridge / open-loop scripting | +68% completion. Open a loop in the hook, pay it off later. |

**Never open with "Hey guys, welcome back," "What's up everybody," or any channel-first intro.** Measurable instant drop-off. Start in the action or the stakes.

---

## Brand Voice (inherited — non-negotiable)

Every hook follows the Ronnie2K copy style:

- **Periods, not exclamation points.** The news is the hype.
- **Specific over vague.** A number, a name, a moment — never "big things coming."
- **Insider proximity, not power.** You were there. You saw it. Don't flex access.
- **Ratings = messenger, not decision-maker.** "I didn't make this rating — but I had to deliver it."
- **No disparaging NBA players** (2K is an NBA partner). Player references competitive, neutral, or positive.
- **No gambling / betting references. Ever.**
- **Honest over sensational.** This is why the Confession hook is so strong for Ronnie.
- **Mode name styling:** always **MyTEAM**, **MyPLAYER**, **MyCAREER** ("My" mixed case, rest all caps). Never MyTeam, MyPlayer, or MyCareer. Hashtags stay lowercase (`#myplayer`).

---

## The Hook Pattern Library

Eleven patterns, merged from both sources. Each lists its mechanism, when it wins, and a 2K example in Ronnie's voice.

### 1. Story / In Medias Res
**Mechanism:** narrative transportation — drop into mid-action, no setup. The brain resists leaving a story.
**Wins:** lowest drop-off; best cold open for longform + cutdowns.
> "Five seconds left. Down one. Brunson's three hits front rim — and OG is already in the air."

### 2. Contradiction
**Mechanism:** cognitive dissonance — a counterintuitive fact the viewer must resolve.
**Wins:** scroll-stopper for TikTok / Reels.
> "Two and nine in January. NBA champions in June."

### 3. Bold Claim
**Mechanism:** a confident declaration that demands proof.
**Wins:** ranking / "best ever" / ratings content.
> "Brunson is a top-seven player in 2K now. He earned every point of it."

### 4. Contrarian
**Mechanism:** stance against consensus.
**Wins:** opinion / reaction videos.
> "Nobody outside New York had the Knicks winning this. Here's how they did it anyway."

### 5. Curiosity Gap (open loop)
**Mechanism:** reveal what they don't know without giving the answer; pay it off later.
**Wins:** suspension-bridge structure, highest completion. Do NOT resolve it in the hook.
> "There's a 71-overall role player who became one of the biggest reasons the Knicks are champions. I'll get to him."

### 6. Stat / Social Proof
**Mechanism:** a number does the talking; authority bias.
**Wins:** Ronnie's "Minimalist" tone; high-status, cold opens.
> "Nineteen seventy-three. That's the last time the Knicks were champions. Fifty-three years."

### 7. Empathy / Problem-Agitation
**Mechanism:** name a shared pain, then signal relief.
**Wins:** fan-emotion content; pair with crowd B-roll.
> "Every Knicks fan knows the words 'wait till next year.' Fifty-three years of next year. It's over."

### 8. Before/After (transformation)
**Mechanism:** two states side by side; the gap is the story.
**Wins:** ratings climbs, season arcs, player glow-ups.
> "Shamet started the year a 71. He's a 77 now — and he earned it in the dark."

### 9. Question
**Mechanism:** rhetorical question pulls the viewer into their own answer.
**Wins:** community engagement; rolls into a stat or reveal.
> "When's the last time the Knicks won a title? If you have to think about it, that's the whole story."

### 10. Confession  ← Ronnie's signature
**Mechanism:** the insider admits something honest — disarms, then earns trust.
**Wins:** the most on-brand opener for Ronnie. Honesty IS the hook.
> "I'll be honest with you. After January, I didn't have the Knicks winning it all. I was wrong."

### 11. List Preview
**Mechanism:** promise N payoffs up front.
**Wins:** listicle / ranking videos and **written** captions. Weak for single-arc VO recaps — skip for those.
> "Three ratings moves this season that nobody saw coming. Number one broke the internet."

### 12. Future Shock / Prediction
**Mechanism:** a call about imminent change — nobody wants to be the last to know.
**Wins:** ratings teases, roster drops, "remember this name" content. The purest Ronnie insider lane.
> "Remember this build. By Christmas, half the Park is going to be running it."

### 13. Authority Steal
**Mechanism:** borrow credibility from an established name, brand, or moment.
**Wins:** proximity content. **Guardrail:** stay on *proximity, not power* — reference the player or the moment, never flex your own access.
> "Post-game, a Finals MVP asked me about his jumper rating. The grind never stops."

---

## Construction Rules

- **No hedging.** A weak hook gets thrown out, not softened. Cut "kind of," "might be," "one of the."
- **One idea per hook.** Open a single loop and move. Don't stack two reveals.
- **Two-line contrast (written / on-screen).** Line 1 short and punchy; Line 2 undercuts it. → "Two and nine in January." / "Champions in June."
- **Numbers: digits when written, words when spoken.** On-screen text and captions use "53," "29," "96." Spoken VO spells them — "fifty-three," "twenty-nine" — so the clone reads them right.

---

## Platform Fit

| Format | Best patterns | Notes |
|---|---|---|
| YouTube longform | Story (1), Confession (10), Curiosity Gap (5) | Open a loop; pay off at the climax. First 5 sec carry the auto-play. |
| YouTube Shorts | Contradiction (2), Bold Claim (3), Before/After (8) | One line, then straight to footage. On-screen title is searchable. |
| IG Reels / TikTok | Contradiction (2), Story (1), Question (9) | Verbal + on-screen hook in the first 1–3 sec. **On-screen text under 6 words.** IG caption hook lives in the first **125 chars**. |
| IG carousel | Bold Claim (3), Stat (6), Question (9) | Opening slide = hook + one idea + a "Swipe →" cue. Nothing else on slide 1. |
| X / written caption | Bold Claim (3), Contrarian (4), Future Shock (12), List Preview (11) | One line **under 280 chars**. Digits, not spelled numbers. |

For **spoken VO**, remember the clone runs **180 wpm** and the 40% rule — write long; openers come in shorter than they read.

---

## Workflow

1. Get the topic/video and the platform (ask if unclear).
2. Generate **5–7 hook variants**, each labeled by pattern, each a complete speakable opener (1–3 sentences).
3. Rate each: **drop-off risk** (Low/Med/High) and **best platform**.
4. Give a **top recommendation + runner-up** with one-line reasoning tied to the format and the brand voice.
5. No two hooks may share the same opening structure or first sentence.

## Output Template

```
## Hook menu — [video/post title]

**1. [Pattern]**
> [opener, 1–3 sentences]
- Drop-off risk: [Low/Med/High] — [why]
- Best for: [platform]

... (5–7 total)

## Recommendation
**Primary:** #N ([pattern]) — [1–2 sentences]
**Runner-up:** #N ([pattern]) — [when to use instead]
```

---

## Did the Hook Work?

Judge hooks on intent signals, not vanity likes:

- **Save rate** — intent to come back (the strongest signal).
- **Comment-to-like ratio** — emotional response, not passive approval.
- **Profile visits / follows from the post** — the hook made them want more.
- **YouTube:** retention at the 30-second mark — 70%+ is solid, 80%+ exceptional.

When A/B testing openers: space them **2–3 weeks apart**, keep the body identical, and compare engagement *rates*, not raw numbers.

---

## Meta-Check (before delivering)

> "Does this sound like a corporate suit trying to be cool?"

If yes: cut adjectives, change any exclamation points to periods, halve the sentence count, and read it back like you're texting someone who plays 2K. If it still sounds corporate, start over.

Then gut-check each hook:

- Would you stop scrolling if you *didn't* write it?
- Does it leave a question the viewer needs answered?
- Is it specific to *this* post — not a line you could paste on any video?
```

---

## 4. AI-Writing Cleanup

**Source:** `.claude/skills/avoid-ai-writing/SKILL.md` (identical copy also at `~/.claude/skills/avoid-ai-writing/SKILL.md`)

This one is long (~62KB) — the full tiered word-replacement tables, pattern catalog, severity tiers, context/voice profiles, and output formats. Rather than duplicate all ~650 lines a second time in this export, the authoritative copy is the file itself — read it directly from either path above when building the product's system prompt. Key structure for adaptation purposes:

- **Modes:** `rewrite` (flag + fix), `detect` (flag only), `edit` (in-place file edit) — for a product feature, you'd want the `rewrite`/`detect` logic only, not the file-editing mode.
- **Tiered word/phrase tables:** Tier 1 (always replace: delve, leverage, robust, seamless, game-changer, etc.), Tier 2 (flag in clusters: harness, elevate, crucial, etc.), Tier 3 (flag by density: significant, innovative, compelling, etc.).
- **Pattern categories:** ~35 distinct AI-writing patterns (template phrases, hedge-stacked predictions, chatbot artifacts, rhetorical question openers, emotional flatline, self-labeling significance, etc.), each with a fix.
- **Severity tiers:** P0 (credibility killers — fix immediately), P1 (obvious AI smell), P2 (stylistic polish).
- **Context profiles:** linkedin / blog / technical-blog / investor-email / docs / casual — each with a tolerance matrix for which rules apply how strictly.
- **Voice profiles:** casual / professional / technical / warm / blunt — independent of context, sets the target register.

For the product's "AI-writing cleanup" feature (Section 6 of the brief), the simplest adaptation is the `rewrite` mode's four-part output (issues found → rewritten version → what changed → second-pass audit), using a `casual` or `blunt` voice profile by default for a young creator audience, skipping the file-editing mode entirely.

---

## 5. Thumbnail Maker

**Source:** `.claude/skills/2k-thumbnail-style/SKILL.md`

```markdown
---
description: Generate consistent YouTube thumbnails for the Ronnie2K channel. Use for any thumbnail request across all content pillars.
---

# Ronnie2K YouTube Thumbnail Style — Prompt Generator

Generate consistent YouTube thumbnails for the Ronnie2K channel using Higgsfield GPT Image 2. Each content pillar has its own visual template.

---

## When to Use

User says: "generate a thumbnail," "make a thumbnail for [episode]," "thumbnail for Park Sessions," or any request for YouTube thumbnail artwork for the Ronnie2K channel.

---

## Universal Rules (All Thumbnails)

- **Aspect ratio:** 16:9, 1920x1080 — always
- **Style:** High contrast, vibrant, YouTube gaming thumbnail aesthetic
- **Background base:** Dark navy (#0A1628) with subtle vignette — unless a specific environment is called for
- **Lighting:** Orange rim light (#FF6B00) on avatar's shoulder/edge — signature look
- **Text:** Bold heavy condensed sans-serif, ALL CAPS. Yellow (#FFD700) with 4px black stroke unless specified otherwise per series
- **Text size:** ~25% of frame height for primary text
- **Avatar:** Ronnie's 2K26 in-game avatar — always the reactor/narrator face, never an NBA player looking bad
- **NBA player rule:** If an NBA player appears, they must be shown in a competitive, neutral, or positive expression. Never defeated, embarrassed, or diminished.
- **No clutter:** Max 2 visual elements (avatar + text, or avatar + player). Clean reads at mobile size.
- **Test at mobile:** Design so text is readable on a phone screen (the majority of viewers are mobile)

---

## Series Templates

### Park Sessions (Pillar 1)

**Layout:** Avatar left two-thirds of frame, waist-up, facing slightly right, direct eye contact. Text right third, vertically centered.

**Expression:** Varies per episode — knowing smirk (Ep 01), laughing/amused (Ep 02), arms-crossed confidence (Ep 03). Each episode should have a DISTINCT expression.

**Text color:** Yellow (#FFD700) with 4px black stroke

**Base prompt:**
```
YouTube thumbnail design, 16:9, 1920x1080. Subject: NBA 2K26 in-game avatar, left two-thirds of frame, waist-up, facing slightly right, [EXPRESSION] expression, direct eye contact. Background: NBA 2K park court blurred, dark navy overlay (#0A1628), subtle vignette. Lighting: orange rim light (#FF6B00) on avatar's left shoulder, high contrast. Text: "[THUMBNAIL TEXT]" bold heavy condensed sans-serif all caps, yellow (#FFD700) with 4px black stroke, right third of frame, vertically centered, ~25% of frame height. Style: high contrast, vibrant, YouTube gaming thumbnail aesthetic.
```

**Variant A — Different text only:** Swap `[THUMBNAIL TEXT]` (e.g., "THEY KNEW" → "THEY FROZE")

**Variant B — Reaction Energy BG:** Add to background: `soft-focus silhouettes of basketball players reacting with raised arms, motion blurred, dark navy overlay maintains readability. Avatar stays sharp in foreground.`

**Variant C — Centered:** `Avatar centered in frame full body, text above avatar's head horizontally centered, symmetrical orange rim light on both shoulders.`

---

### The Messenger (Pillar 2)

**Layout:** Split frame — avatar on one side, player screenshot or rating number graphic on the other. More editorial/documentary feel.

**Expression:** Thoughtful, serious, slight concern — "the messenger delivering news" energy

**Text color:** White with subtle dark drop shadow — cleaner, less hype than Park Sessions

**Base prompt:**
```
YouTube thumbnail design, 16:9, 1920x1080. Left side: NBA 2K26 avatar in thoughtful serious expression, waist-up, looking slightly off-camera. Right side: [PLAYER NAME] NBA player screenshot or large rating number "[RATING]" in bold white. Background: dark gradient, moody blue-gray tones (#1A2332 to #0A1628). Subtle orange accent light on avatar. Text: "[THUMBNAIL TEXT]" clean white sans-serif, bottom third. Style: editorial, documentary feel, high contrast, YouTube gaming thumbnail.
```

---

### Rating Reaction (Pillar 3)

**Layout:** Player-focused — large player image or rating number dominates. Avatar smaller or absent. Designed for batch production.

**Text color:** Yellow or red depending on whether the rating is a boost or a drop

**Base prompt:**
```
YouTube thumbnail design, 16:9, 1920x1080. Center: large bold rating number "[RATING]" in [yellow for boost / red for drop], 40% of frame height, thick black stroke. Behind number: [PLAYER NAME] action shot, slightly blurred. Background: dark navy (#0A1628). Small Ronnie2K avatar reaction face in corner (optional). Text: "[PLAYER NAME]" clean white sans-serif below rating. Style: bold, immediate, scannable at mobile size, YouTube Shorts thumbnail.
```

---

### Your Stats Don't Lie (Pillar 4)

**Layout:** Gamertag-focused — text-heavy with stats overlay feel. Mock UI/dashboard aesthetic.

**Text color:** Green/cyan (#00FF88) for stats — gaming HUD energy

**Base prompt:**
```
YouTube thumbnail design, 16:9, 1920x1080. Mock gaming stats overlay aesthetic. Large gamertag text "[GAMERTAG]" in green (#00FF88) with dark stroke, top third. Stats numbers scattered: shooting %, playtime hours, win rate. Background: dark navy (#0A1628) with subtle grid/HUD pattern. Ronnie2K avatar in corner with "we looked you up" energy. Style: data visualization meets gaming UI, clean, readable at mobile size.
```

---

### Finals Sim / NBA 2K Sim (Pillar 5 / Inside Access)

**Layout:** Team vs. team — split frame with team colors/logos, dramatic sports broadcast energy.

**Text color:** White with team-color accents

**Base prompt:**
```
YouTube thumbnail design, 16:9, 1920x1080. Split frame: [TEAM 1] colors on left, [TEAM 2] colors on right, dramatic diagonal divide. Team logos or key player silhouettes on each side. Center: "[SIM RESULT TEXT]" bold white condensed sans-serif with slight glow. Background: dark with team color gradients. Optional: Ronnie2K avatar small in bottom corner. Style: sports broadcast graphic, dramatic, high contrast, YouTube gaming thumbnail.
```

---

## A/B Testing Workflow

For every longform upload, generate **3 thumbnail variants:**
1. Primary template (standard layout for that series)
2. Text variant (different hook text, same layout)
3. Layout variant (centered vs. split, or with/without avatar)

Upload primary at publish. Swap to best performer after 48 hours based on CTR in YouTube Studio.

---

## Tool Guidance

- **Primary tool:** Higgsfield GPT Image 2 (via `higgsfield-generate` skill)
- **Always 1920x1080, 16:9**
- **Generate all 3 variants in one batch** when possible
- **Text rendering:** AI image generators often struggle with text. If text comes out wrong, generate without text and add in Canva/Premiere instead. Note this to user.
- **Mobile test:** After generation, mentally crop to a small rectangle — if text isn't readable, simplify
```

**Adaptation note for the product's genericized "vibe dropdown" (Section 6b of the brief):** the templates above are structured as reusable layout patterns already (layout + expression + text color + a fill-in-the-blanks base prompt). Building the "Gritty Open-World Action" / "Arcade Sports" / "Cozy Food & Lifestyle" dropdown options means writing new template blocks in this same shape, with the NBA 2K-specific elements (avatar, team colors, rating numbers) replaced by generic equivalents, and the "NBA player rule" replaced by a generic content-safety rule for whatever real people/brands might appear in a user's own thumbnail request.

---

## 6. Avatar-ify

**Source:** `.claude/skills/2k-cutscene-style/SKILL.md`

This file is long (~53KB) — full style DNA (rendering, characters, lighting, camera, color), a base prompt template, 20+ scene-type modifiers (arena, locker room, city storefronts, music studio variants, broadcast graphics package), and a 158-entry reference screenshot catalog (not reproduced here — actual image files live in `.claude/skills/2k-cutscene-style/reference-screenshots/`). Read the file directly for the full content; the parts most relevant to adapting into the product's genericized "video-game cutscene avatar" feature (Section 6a of the brief) are:

**Core Style DNA (the reusable "why this looks like a game, not a photo" rules):**
- Real-time 3D game engine quality — high polygon, smooth clean surfaces, no film grain/noise/lens artifacts
- Subsurface scattering on skin: slightly polished/waxy quality, plastic sheen on foreheads/cheekbones
- Simplified hair as a key tell: buzz cuts as stippled texture, afros as volumetric blobs, never strand-level
- Soft diffused lighting, no harsh shadows, rim lighting on main characters to separate from background
- Warm, slightly desaturated color palette; muted casual-clothing tones
- Camera: over-the-shoulder as dominant framing, extreme close-ups with shallow DOF, low-angle hero shots

**Base Prompt Template (the reusable structure):**
```
NBA 2K video game cutscene screenshot. [SCENE DESCRIPTION]. Real-time 3D rendered, high-polygon game engine quality. Smooth subsurface scattering on skin, slightly polished complexion with plastic sheen on forehead and cheekbones. Soft diffused lighting, no harsh shadows, subtle ambient occlusion. Warm amber skin tones. Simplified hair rendered as texture maps, not individual strands. Cinematic camera framing, shallow depth of field on background. Warm slightly desaturated color palette. Muted clothing tones. Clean geometry, no film grain or noise. 16:9 widescreen aspect ratio. Unreal Engine 5 quality, NBA 2K26 MyCAREER cutscene aesthetic.
```

**Adaptation note (ties to Section 6a/6b's genericization requirement):** this template's first sentence and its last clause ("NBA 2K video game cutscene screenshot" / "NBA 2K26 MyCAREER cutscene aesthetic") are the only NBA-2K-specific parts — everything in between (rendering quality, skin/hair treatment, lighting, camera, color) is a generic "video game cutscene" style descriptor already. The genericized product version replaces just those two bookend phrases with something like "stylized video game cutscene screenshot" / "modern AAA game cutscene aesthetic," keeping the entire style-DNA payload intact.

**Tool guidance from the file:** primary tool is Higgsfield GPT Image 2; always 16:9 (1920x1080) unless the user specifies otherwise; generate 2-3 variants per request; do not add film grain, lens flare, chromatic aberration, or bokeh — the look is clean digital render, not photographic.

### Supporting technique skills

**`.claude/skills/seedance2-skill/SKILL.md`** and **`.claude/skills/video-prompting-skill/SKILL.md`** — both contain reference material on video-generation prompting (the `@` reference system for Seedance 2.0, camera language, character-consistency patterns, model-specific prompting guides for Sora/Veo/Wan/LTX). **Flagged again: both directories contain `.git`, `README.md`, and `LICENSE` files, indicating these are cloned third-party/open-source repositories rather than original work.** Check the LICENSE terms in each directory before building commercial product logic on top of their content. Not reproduced in full here for that reason — read directly from the source paths if their license permits reuse.

---

## 7. Transcript Puller

**Source:** `.claude/skills/2k-yt-transcript/SKILL.md`

```markdown
---
name: 2k-yt-transcript
description: Pull the transcript/caption text out of a YouTube video link. Use when the user pastes a YouTube URL and wants the transcript, captions, subtitles, or spoken text — e.g. "get the transcript", "transcribe this video", "what does this video say", "pull captions from this link".
---

# YouTube Transcript Extractor

Extracts the text transcript from any YouTube video using its existing caption
track. No download, no API key, no Apify cost — runs locally and instantly.

## How to run

The script lives next to this file. Run it with the video URL or ID:

```bash
python3 transcript.py "<youtube url>"
```

### Options
- `--timestamps` — one line per segment, prefixed `[mm:ss]` (good for finding a moment / chaptering)
- `--lang xx` — preferred caption language (default `en`; always falls back to en)
- `--out FILE` — write to a file instead of printing (use for long videos so you don't flood the chat)

## Behavior notes
- Accepts full URLs, `youtu.be` short links, `/shorts/` links, or a bare 11-char video ID.
- Primary path: `youtube-transcript-api`. If that fails (rare regional/anti-bot block), it auto-falls back to `yt-dlp --write-auto-subs`.
- For long videos, prefer `--out` and then summarize/quote from the file rather than dumping the whole thing into chat.

## When NOT to use this
If the user wants *unattended/scheduled* transcription (e.g. auto-transcribe every new upload on a channel into a Google Sheet), build an n8n workflow instead — this skill is for on-demand, paste-a-link use.
```

**Source:** `.claude/skills/2k-yt-transcript/transcript.py`

```python
#!/usr/bin/env python3
"""Pull the transcript/captions text from a YouTube video link.

Usage:
    python3 transcript.py "<youtube url or video id>" [--timestamps] [--lang en] [--out FILE]

Defaults to clean paragraph text (no timestamps). Uses YouTube's existing
caption track via youtube-transcript-api (no download, no API cost).
Falls back to yt-dlp auto-subs if the API can't fetch them.
"""
import argparse
import re
import subprocess
import sys
import tempfile
import os


def extract_video_id(s: str) -> str:
    s = s.strip()
    # Already a bare 11-char id
    if re.fullmatch(r"[0-9A-Za-z_-]{11}", s):
        return s
    patterns = [
        r"(?:v=|/shorts/|/embed/|youtu\.be/|/v/)([0-9A-Za-z_-]{11})",
    ]
    for p in patterns:
        m = re.search(p, s)
        if m:
            return m.group(1)
    raise ValueError(f"Could not extract a video id from: {s}")


def via_api(video_id: str, lang: str):
    from youtube_transcript_api import YouTubeTranscriptApi
    api = YouTubeTranscriptApi()
    fetched = api.fetch(video_id, languages=[lang, "en"])
    # fetched is iterable of snippets with .text, .start, .duration
    return [(snip.text, snip.start) for snip in fetched]


def via_ytdlp(url: str, lang: str):
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "sub")
        subprocess.run([
            "yt-dlp", "--skip-download", "--write-auto-subs", "--write-subs",
            "--sub-langs", f"{lang},en", "--sub-format", "vtt",
            "-o", out, url,
        ], check=True, capture_output=True)
        vtt = next((os.path.join(tmp, f) for f in os.listdir(tmp) if f.endswith(".vtt")), None)
        if not vtt:
            raise RuntimeError("yt-dlp produced no subtitle file")
        text = []
        seen = set()
        for line in open(vtt, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith(("WEBVTT", "Kind:", "Language:")) or "-->" in line:
                continue
            line = re.sub(r"<[^>]+>", "", line)
            if line and line not in seen:
                seen.add(line)
                text.append((line, None))
        return text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--timestamps", action="store_true", help="prefix each line with [mm:ss]")
    ap.add_argument("--lang", default="en")
    ap.add_argument("--out", help="write to file instead of stdout")
    args = ap.parse_args()

    try:
        vid = extract_video_id(args.url)
        try:
            segments = via_api(vid, args.lang)
        except Exception as e:
            print(f"[api failed: {e}; falling back to yt-dlp]", file=sys.stderr)
            segments = via_ytdlp(args.url, args.lang)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    lines = []
    for text, start in segments:
        text = text.replace("\\n", " ").strip()
        if not text:
            continue
        if args.timestamps and start is not None:
            ts = f"[{int(start)//60:02d}:{int(start)%60:02d}] "
            lines.append(ts + text)
        else:
            lines.append(text)

    output = "\\n".join(lines) if args.timestamps else " ".join(lines)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(output + "\\n")
        print(f"Wrote {len(lines)} segments to {args.out}")
    else:
        print(output)


if __name__ == "__main__":
    main()
```

**Adaptation note:** this script currently only handles YouTube. Extending it to TikTok/IG for the product (per the brief's "multi-platform transcript puller") means adding a scraping-based audio-extraction step for those platforms, since neither has an equivalent public captions API — same hybrid data-sourcing posture as the rest of the brief (official API for YouTube, scraping elsewhere).

---

## 8. Shelved — Kept for Reference Only (6a-shelved)

These two back the full-service HeyGen-animated-avatar idea that was explicitly shelved in the brief (Section 6a-shelved) — the market gap doesn't exist, the cost breaks the $10/mo model, Avatar V is restricted to curated avatars, and voice-cloning-at-scale is a trust risk. Keeping the source paths on file only in case that idea is revisited under different constraints.

**Source:** `.claude/skills/2k-heygen-avatar-reference/SKILL.md` — consistent reference specs for HeyGen talking-head clips (reference image spec, 5-segment emotional-beat script structure, ElevenLabs voice settings, consistency checklist, output specs for Premiere).

**Source:** `.claude/skills/2k-elevenlabs-vo-guide/SKILL.md` — voice registry, stability/style-exaggeration settings, script formatting for emotion, duration math (words-per-minute tables), the "40% rule" for script length, multi-take workflow.

Both are internally consistent with each other (segment structure, voice settings) and with the HeyGen cost/technical findings already cited in the brief's Section 6a-shelved. Read directly from source if the shelved idea is revisited.
