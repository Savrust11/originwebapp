# Evidence section applicability contract

This additive contract separates stable document/version bibliography from the
scope of one original-text section. It is deliberately conservative: absent
metadata is `unknown`, never unrestricted.

## Stored policy

`evidence_versions.section_policy_defaults` is the document baseline and
`evidence_sections.applicability_policy` is the section policy. Both have the
same dimensions:

- `weiku`: intended target (`child` or `caregiver`), applicable child age,
  conditions/exclusions, and an explicit Japan applicability decision;
- `research`: research participant age (including a distinct `mean` form) and
  research locations. These are descriptive and do not establish We育 scope;
- `certainty`: level, assessment method, and its original source location;
- `usage`: terms and restrictions for the selected text.

Each section dimension has `mode: "unknown" | "inherit" | "specific"`.
Document defaults only allow `unknown` or `specific`. `inherit` takes the
document value; `unknown` stays unverified. A section-specific value can add
precision but cannot loosen a known document exclusion or usage restriction:
effective exclusions/restrictions are accumulated from both levels.
The pre-existing version-level age, region, condition, and exclusion columns
remain a third, restrictive document layer during migration. They are returned
in `source.age`, `source.regions`, and `source.conditions`, and are combined
with the JSON policy before a section is eligible. Thus a raw section policy
of `unknown` is still unverified, but cannot conceal a known parent mismatch.
An older version can have known exclusions while its positive condition scope
is `unknown`; those exclusions are still enforced, but an inheriting section
does not become condition-`matched` merely because no exclusion was supplied.

`usageTerms: null` means the machine-readable status is unknown; it does not
mean use is permitted. Existing reviewed free-text `usage_terms` remains
document review provenance and is always returned separately.

## Search

`SearchInput.context` is optional structured context only:
`{ target?: "child" | "caregiver", conditions?: string[],
absentConditions?: string[], japanApplicability?: boolean }`. `conditions`
means conditions explicitly known present; `absentConditions` means explicitly
confirmed absent. The same condition cannot be in both lists. An omitted item,
including an empty list, does not prove that it is absent.
The service does not infer either value, conditions, or an audience from the
question, family data, or care records. `ageMonths` means the explicitly
requested child age.
`japanApplicability: false` means Japan applicability is not being assessed;
it never reverses an `applicable`/`inapplicable` Japan decision into a claim
about another country. It is rejected together with an explicit `Japan`/`日本`
region.

Known target, age, Japan-applicability, or condition incompatibility excludes a
section. Missing input or unknown policy remains `unverified` in the result,
not `matched`. Search returns original text, its original citation location,
raw document/section policy, resolved policy, applicability status, and
limitations. Results are ranked and limited only after this eligibility check.
For conditions, a present exclusion or an explicitly absent requirement is a
known mismatch. A requirement not reported present, or an exclusion not
reported explicitly absent, stays `unverified`; it is never treated as a
negative fact. Even an unrestricted policy can remain unverified without
explicit condition context.
Candidates are read in deterministic, bounded pages. If the configured scan
budget is reached, results include
`diagnostics: { reason: "candidate_scan_limit" }` rather than appearing
complete.

Published section policy is covered by the existing all-column section
immutability trigger. The additive migration validates its JSONB values
fail-closed before they are stored.