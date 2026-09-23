# P01 aggregation addendum: isolated offline editorial prototype

This directory does not import or change the app, database, provider SDK,
normal consultation route, or workflow. No model API sends are authorized.

## Provenance

The immutable E02 still has its original unknown aggregation. A separately
sealed candidate `MHLW-MINUTES-20231221` links only to `E02-S01`.
It clarifies inclusion of naps for ages 1–2, not other ages, nap prescriptions,
effects, health sufficiency or clinical decisions.

The source is minutes of draft-guide deliberations, not the final guide and not
an independent effect study. The cited question/answer and continuous surrounding
exchange are exact substrings of the saved text extraction. Source notes are
separate from quotations. Extraction hashes are not claims to raw HTTP byte
identity; the supplementary direct-HTML check separately records its hash.

PDL1.0, MHLW important information and the exceptions appendix were inspected.
No individual restriction was identified for the selected passage; absence of
a notice is not a guarantee of third-party rights clearance. Attribution and
processing disclosure identify Replit Agent, not MHLW, as the editor.
No figures, images, logos or external attachments were imported.

CDC is only a short verification record under `cross-check-only/`. It is never
loaded into the source/renderer payload or search data. Its reference 2 and
E02 reference 5 identify the same AASM 2016 pediatric consensus; they are not
counted as separate independent studies.

## Boundaries

`model.mjs` has separate arithmetic, source aggregation, numeric comparison and
health-judgment fields. Missing/invalid/revoked linkage prevents comparison.
Input eligibility does not erase a correctly linked source's general aggregation
definition. Input assumptions are explicit fictional/conditional fixtures, not
facts inferred about the questioner.

`render.mjs` uses a single renderer for linked, unlinked and negative-input
states. Unlinking rebuilds claims and citations; it does not merely hide a badge.
This is not generalized free-text answering, semantic detection, or a clinical
assessment. Source matching and seals are not formal adoption or publication.

`verify-temporary.mjs` runs deterministic tests and Chromium with network blocked
and only file/data URLs. It closes its browser and removes its owned temporary
directory in `finally`. Its no-overwrite evidence is separate from all old runs.
`package-evidence.mjs` packages static old/new images, citations and review notes
after cleanup. No running service remains.