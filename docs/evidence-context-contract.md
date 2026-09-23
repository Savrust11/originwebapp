# Evidence required-context contract

`evidence_section_required_context` records an editorially mandatory link from
one original section to another original section in the **same source version**.
Both endpoints use composite foreign keys to that version's original sections;
the link cannot name a derivative, an external source, or a section from a
different version. `role` is a bounded editorial label, not a retrieval score
or an applicability decision.

Search ranks only the matched root original section. It then attaches the
root's `requiredContext` sections with their original text, source-version
citation, original location, notes, and raw section policy. Context is fetched
from the link even if its text has no keyword match, and never appears as an
independent result. Source-version citation metadata remains available on every
attached item.

Traversal is bounded (depth 4; at most 16 unique attached sections per root).
It excludes the root and deduplicates reachable sections, so a cycle such as
`E01S02 → E01S04 → E01S02` is safe. A malformed/missing attached item or a
graph beyond either budget fails closed for that root and returns
`diagnostics.reason` of `context_incomplete` or `context_limit`, rather than
silently presenting incomplete context as a normal result.

Links may be maintained while their version is draft. They become immutable
when that version is published, alongside the existing section and version
immutability rules. This migration does not alter review requirements,
publication approval, current-version selection, authentication, or the
ephemeral-only test-data guard.

For a logical age unit that spans selected adjacent bands, store one original
section with its explicitly reviewed union range (for example, 12–71 months).
Do not derive that range by intersecting disjoint section ranges such as S01
and S02. Any mapping from a logical unit to selected source bands belongs in a
separate review manifest; it must map (for example) 24-month S01 and
48-month S02 and cite the shared original section exactly once. Inline
attribution to an external AASM source is source metadata, not another root or
required-context source.