---
name: Retrieval scope diagnostics
description: Distinguish saved corpus, loaded evaluation subset, term linkage and fact projection before reporting missing evidence.
---

Do not describe a zero-result test over a selected corpus subset as absence from
the saved source collection. Audit the saved ledger and the run's import manifest
separately; keep corrections append-only.

**Why:** A feeding-start passage with footnotes and historical successful searches
was omitted from a later sleep/research-only run. Calling this “missing material”
obscured that it was saved but not loaded.

**How to apply:** Track saved originals/context, instance inclusion, witnessed
retrieval, and fact-projection availability independently of approval. Unknown
retrieval causes must stay unknown rather than become scientific-absence claims.

Test aliases through their complete concept-to-original linkage, not merely
their presence in a dictionary.

**Why:** A shared Japanese keyword was reassigned to a later concept by a globally
unique keyword upsert. The original existed, but a synonym for the earlier
concept could not reach it.

**How to apply:** Check existing assignments before adding shared keywords; use
an exact distinctive original phrase where appropriate. Measure negative examples
as well as new hits. A recall improvement can introduce new false positives and
does not authorize activating the dictionary in normal routes.

## Candidate relevance and confirmation

Keyword hits and matching age conditions are not proof that a source answers the
question. Explicit topic confirmation may permit topic-specific general
information; it is not a semantic adequacy or clinical-appropriateness judgment.

**Why:** Product and photography requests can retrieve childcare sources. A user
who wrongly confirms a proposed topic can still unlock unrelated information,
even though ordinary reject/rephrase cases show no leakage.

**How to apply:** Freeze relevance expectations before implementation, report
candidate retrieval separately from fact/comparison exposure, and disclose
wrong-confirmation cases alongside primary results. Count pauses on related
questions and explicit selections as user burden, not only final false blocks.
Input changes must invalidate confirmation and synchronously remove stale output;
late successes or errors must not overwrite the latest state.

## Separate material selection from personal comparison

This rule describes the material-selection prototypes. For the later
conversation-first design, see `conversation-first-editorial-policy.md`; do not
turn internal evidence checks into mandatory parent-facing forms.

Selecting a topic means choosing which materials to display, not confirming that
the original question has been answered. Personal numeric comparison needs a
separate explicit operation, even when all input values are already available.

**Why:** Selecting the wrong topic could previously unlock a comparison without
the user intentionally requesting that distinct operation.

**How to apply:** Reuse existing explicit inputs, show the exact inputs and
aggregation conditions beside the comparison, and invalidate the comparison on
edits without unnecessarily asking the user to choose the same materials again.
A comparison requested for one child must not implicitly compare another child.

## Preserve shared vocabulary ownership when extending a corpus

Treat shared keyword-to-concept ownership as part of preservation, not just
the old document bytes.

**Why:** Adding municipal materials reassigned shared keywords to new concepts
through globally unique term upserts, breaking retained synonym retrieval even
though earlier source documents were unchanged.

**How to apply:** Preserve existing concept ownership, use source-specific
headings where appropriate, and verify retrieval for every retained unit after
loading additions. A retrieval regression never authorizes using an existing
database instead of owned disposable storage.

## Empty candidates do not prove a boundary works

Distinguish a search rejection from a successful geographic or population
exclusion, and retain the unmodified failing question when narrowing a test.

**Why:** After corpus expansion, even a single-service, same-named-ward question
hit the native vocabulary-expansion limit. Splitting a compound question did not
resolve it. Zero raw hits could otherwise be mistaken for safe regional filtering.

**How to apply:** Require a real pre-filter candidate in negative controls and
record search diagnostics separately. Do not bypass a native guard or restrict
the corpus to expected results merely to pass the test. Report incomplete
verification separately from successfully prepared source records.

When diagnosing this limit, distinguish dictionary row identity, normalized
lexical identity, and concept-scoped identity. Count the directly matched terms
and their unmatched sibling aliases separately before selecting a fix.

**Why:** The municipal corpus failure came from one-hop concept fanout, not
recursive expansion. Deduplicating text alone appeared sufficient but would
merge distinct concept links; concept-preserving dedup still exceeded the limit.

**How to apply:** Preserve raw queries and trace actual dictionary rows. Separate
geographic eligibility from topical evidence, and validate any restriction of
sibling expansion against both source-heading and natural-question regressions.
Keep the overflow diagnostic and test an actual over-limit fixture after repair.

## User confirmations versus evidence verification

Users confirm facts about their own records, not whether a source is valid.
Source identity, preserved text, linkage and applicable age scope must be checked
by the system. Explain original-only uncertainty separately from what a verified
supplement establishes; neither verification nor a checkbox grants publication approval.

**Why:** A reviewer-oriented source-link checkbox had become a user prerequisite,
and original-only uncertainty remained confusing after supplemental evidence was available.

**How to apply:** Keep record-condition confirmations distinct from reviewer
details. Do not silently treat an empty years field as zero merely because months
are present; request the missing input and explain comparison eligibility.