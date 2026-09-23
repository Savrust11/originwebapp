---
name: Evidence validation boundary
description: Keep engineering tests, medical evidence adoption, and real retrieval quality separate.
---

Fictional corpus tests demonstrate search and access-control behavior, not clinical evidence quality or adequate coverage of parenting questions. Do not present passing tests as approval for real advice or automatic source adoption.

**Why:** The user deliberately separates this retrieval foundation from AI answers and requires adoption rationale, applicability review, and Japanese-context checks rather than approval based only on publisher, language, or peer-review status.

**How to apply:** Before proposing activation, real-corpus import, or answer generation, obtain the separately required approval and distinguish human source review from retrieval benchmarking. Neither translated content nor retrieval ranking establishes stronger scientific evidence.

## Qualitative guidance and mandatory context

Do not manufacture quantities to fit qualitative public guidance into a
numeric-fact interface. Preserve quoted text with source/version/section identity,
and keep editorial examples distinct from source facts and model output.

**Why:** The user-authorized handbook contains nonnumeric practice guidance.
A numeric-only representation would require invented values, while a display
without its separately located safety context could turn watchful support into
advice to leave a child unaided.

**How to apply:** Use an explicitly typed qualitative representation. Required
context must remain a verifiable source relation, not merely a caution string
copied into the example. Test deletion or mismatch of the relation and block the
dependent proposal; do not count that context as another independent study.

## Missing applicability facts

Treat a reported condition list as incomplete knowledge, not proof that all unlisted conditions are absent. Confirmed presence, confirmed absence, and unknown are separate facts.

**Why:** Otherwise an incomplete intake can silently satisfy an exclusion check, falsely making a passage look suitable. Conservative unknown results are preferable to manufacturing a negative health fact.

**How to apply:** Future UI, import, and AI consumers must preserve this distinction. Do not infer missing health facts from a question, study averages, or personal records to turn an unverified result into a matched result.

## Real-source tests are not adoption

Keep real-source retrieval tests separate from fictional-corpus runs. Any
temporary publication simulation must have its own explicit provenance and
must never populate human-review or adoption-approval fields.

**Why:** Fictional keyword matches can contaminate real-source evaluation.
Setting a human-review flag merely to satisfy a publication gate also creates
false approval history, even when the surrounding work is described as AI review.

**How to apply:** Use separately owned disposable runs, preserve the original
draft/unapproved extraction files, and report simulation status separately.
Confirm shared study eligibility exclusions apply to every selected outcome;
do not rely on one outcome's shorter editorial note to reconstruct them.

## Confirmation belongs to a person and a question

Do not reuse family records as applicability facts without separate approval.
Keep a caregiver's facts and each child's facts separate; a lexical match for
a diagnosis is not a confirmed diagnosis.

**Why:** The user explicitly chose a consultation flow with confirmed inputs
instead of automatic family-data lookup. Otherwise the wrong child's age or a
caregiver's condition can silently be used to judge a study's applicability.

**How to apply:** Preserve unknowns, ask about health only when a retrieved
study requires it, and invalidate confirmations when the person or question
changes. Do not discard those answers merely when the user checks the final
confirmation box. Private prototype testing must not start the normal app,
including indirectly through a historical lifecycle-test bootstrap.

## Offline answer tests are not model answers

Keep transport doubles inside tests, never in a runnable screen presented as
an AI response. Do not change real-source review or applicability metadata just
to make a generation branch reachable.

**Why:** The user explicitly separates communication-free engineering checks
from actual Japanese answer-quality evaluation. A valid citation proves only
reference membership, not that a claim follows from it or preserves uncertainty.

**How to apply:** Keep structural citation checks, current-version comparison,
and human semantic review separate. Mark offline screens as system checks, not
model answers. Before enabling real sends, separately resolve free-text privacy,
source adoption, emergency routing, and the existing publication/update race.

## Freshness is broader than the model payload

Compare full local evidence semantics for freshness, while keeping the planned
external payload minimal.

**Why:** A privacy-reduced payload can omit applicable-policy, usage or required
context metadata. Hashing only that projection can miss a material change even
when the original text and citation IDs are unchanged.

**How to apply:** Include those local metadata changes in revalidation without
sending reviewer identities or other unnecessary fields to a provider. This
comparison still does not replace atomic publication/update controls.

## Connection approval is not source or execution approval

Keep connection setup, paid-run authorization, and source/applicability approval
as separate decisions. An evaluation packet can define what a source-based
answer would be allowed to say without making that source approved for a person.

**Why:** The user wants fictional model evaluation prepared before consenting to
the connection method and cost. Existing unapproved materials can otherwise
tempt a later agent to relax gates merely to obtain example answers.

**How to apply:** Freeze questions and rubrics before generation. If the normal
gate blocks all questions, report that honestly; propose separately scoped
source-reading evaluation rather than silently promoting metadata or bypassing
the personalized-advice path. Budget alerts are not authorization or hard stops.

The user confirmed the separate source-reading/translation evaluation approach:
fictional target conditions are test inputs, never actual applicability approval.
Keep normal-path stopping checks separate from the reading evaluation, and never
present its outputs as advice to ordinary users.

**Why:** This permits evaluation of language fidelity without manufacturing
clinical adoption or weakening the consultation gates.

**How to apply:** Define each question's evaluation lane before sending. Check
the current run's explicit authorization and caps separately; this architectural
decision is not standing permission for paid calls.

## Token counting can itself disclose the evaluation material

Treat a remote token-count request as an external disclosure, not as an offline
check. Count metadata reads and token-count attempts against the authorized
cumulative provider-API cap, carrying previous calls forward when plans change.
Do not silently exclude them or assume counting
inherits a generation endpoint's billing, retention, or cache controls.

**Why:** A counting step can send the same source material a second time and make
an otherwise compliant generation plan exceed the authorized communications.
Tokenizer examples also do not establish exact framing/schema counts for a
different model.

**How to apply:** Account separately for metadata reads, input-count requests,
and generations. Confirm the counting endpoint's documented terms and the
user's authorized scope before sending source text. If an authorized hard limit
cannot be demonstrated, keep real execution disabled and report the gap.
When case-count reduction is already authorized, use that option rather than
truncating required source context or asking for the same permission again.
Complete separately authorized no-provider normal-route verification even if
the live-reading input bound remains blocked.

## Hard cost guarantees and operational budgets are different authorizations

Follow the current explicit authorization, rather than carrying an obsolete
hard-token-bound requirement into an operational-budget trial. Operational
estimates are not invoice guarantees; retain the separate transmission cap and
privacy constraints and review each actual usage/result before continuing.

**Why:** An explicitly relaxed budget can permit a locally estimated pilot even
when server-side token serialization cannot be bounded exactly. That does not
permit silent retries, extra purchases, automatic top-up changes, or ignoring
unknown usage, incomplete answers or serious source-grounding failures.

**How to apply:** Preserve authorization history and the cumulative ledger.
Do not treat an earlier trial's authorization as standing permission for later
calls. Label estimates, usage-based calculations and reconciled invoices
separately, and never assume observed server token differences are constant.

## Editorial notes are not primary evidence

Keep explanatory/editorial notes distinct from citable original excerpts.
An apparently correct statement can still fail provenance when the model cites
a unit or editorial-note identifier as though it were an original section.

**Why:** A reading trial returned a plausible sleep-duration clarification but
cited internal notes instead of an original passage; the accompanying reference
was bibliographic metadata, not the primary paper's wording.

**How to apply:** Validate source/version/section against the sent original
excerpts, and review whether each substantive qualifier is directly supported
or only asserted by an annotation. Preserve the actual failed answer in reports;
do not repair its citations after the fact or approve sources to bypass the gap.

## Structural citation repair is not semantic approval

Keep mandatory attribution in the preregistered meaning review even when every
selected original ID is valid and the unsupported qualifier has been removed.
Do not replace the model or loosen citation checks to make a reading trial pass.

**Why:** A revised reading answer stopped misusing editorial notes but still
omitted the originating organization's attribution. Metadata assembled by the
application cannot silently repair a missing qualification in the explanation.

**How to apply:** Evaluate the actual explanation against the frozen criteria,
not only the ID list. When instructions permit withholding through either a
limitations field or an abstention field, accept equivalent withholding meaning;
do not invent a requirement for one boolean flag after seeing the response.
Any further paid execution after a run-wide stop needs a new explicit
authorization, not the unused balance from the previous run. A case-quality
failure is distinct when independent continuation has explicitly been authorized.

## Public accessibility does not resolve ingestion rights

If reuse terms for supplementary original text cannot be established, preserve
the rights question as pending and evaluate explicit withholding from the
actually supplied originals instead.

**Why:** A publisher's accessible article and permissions link do not by
themselves establish permission for extracting text and sending it to an
external model; nor does uncertainty establish a legal prohibition.

**How to apply:** Record the checked rights sources and the withheld scope before
sending. Keep editorial verification, bibliographic metadata, original evidence,
applicability conditions, and service restrictions distinct. Do not promote a
service restriction into a claim made by the original author.

## Independent case failures and app attribution have separate verdicts

For explicitly authorized independent evaluations, record an answer-quality
failure without stopping unrelated cases. Still stop the entire run for unknown
usage, uncertain transmission outcomes, unauthorized data, broken accounting,
or compromised safety boundaries. No quality failure authorizes a retry.

**Why:** Continuing independent questions reveals translation and exclusion
handling that an earlier attribution omission would otherwise leave untested.
It does not change the failed case's criteria or authorize spending beyond the
named cases and cumulative limits.

**How to apply:** Freeze the case/global distinction before sending. Preserve
old failures and raw responses; evaluate app-added attribution separately from
model quality. Link a verified publisher-to-recommendation-body relationship
only to the specific explanations it supports, never infer that relationship
for every source or attach it from an ID match alone. Negative boundary rules
such as “do not extend to other ages” are satisfied by not extending; do not
invent a requirement to explicitly repeat a negative sentence after seeing an
answer.

## Mandatory context belongs to the application, not a model summary

Keep verified population, eligibility, exclusions, consequential limitations,
and numerical meaning beside the relevant explanation as source-bound
application data. Do not infer missing conditions from prose. Adjacent source
cards cannot cure an unsupported or contradictory body, and saved failures
remain diagnostic-only.

**Why:** Model summaries repeatedly omitted eligibility and exceptions even
when their main conclusions were accurate. The user chose deterministic
retention of confirmed context rather than relying on longer model summaries.

**How to apply:** The user adopted the three-tier rubric for the separately
identified general-audience evaluation: mandatory meaning, question-dependent
statistics, and genuinely optional background. Keep each evaluation's rubric
explicit and freeze the distinction before sending; adoption does not authorize
historical rescoring or later API calls. Unknown or mismatched applicability must still block personal
advice. An edited illustration is not a new model answer or approval, and changing
its body or structured conditions requires a new explicit source comparison.

## Omitted attribution and false attribution are different

For prospective evaluations, distinguish semantic correctness from attribution
presence and from where the verified information is displayed. If the question
does not directly ask for the recommending body, neutral omission may be supplied
by an adjacent verified card; false attribution or contradictory prose cannot.
If the question directly asks who made the recommendation, that answer belongs
in the body. Keep historical verdicts under their original frozen requirements.

**Why:** A historical evaluation made attribution in the body mandatory. That
scoring choice must not become a claim that a correct adjacent attribution can
never complete otherwise accurate prose, nor justify retrospectively passing
the old answer.

**How to apply:** Before generation, assign ownership of each required fact to
the body or application and distinguish question coverage, factual fidelity,
attribution presence, and screen completeness. Score Japanese readability
separately; a wording problem that changes substantive meaning also affects
fidelity.

## Compare models under the same new protocol

When instructions or scoring change, regenerate both models under the same
prospective protocol rather than compare a new model against historical answers.
Keep known-case regression results separate from newly authored questions, and
do not call questions on familiar sources an unseen-corpus evaluation.

**Why:** Otherwise improvements from changed prompts, app context, or grading
can be incorrectly attributed to the model. Familiar problems alone also reward
targeted adjustments.

**How to apply:** Fix both sets of questions, full originals, generation rules,
app context, and scorer-only criteria before sends. Hide model metadata from a
fresh scoring context where feasible, record blinding limits, and retain ties
instead of inventing outcome-dependent weights. Preparation is not permission
for generation, entitlement checks, or use of an unused prior transmission slot.

## Preserve evidence for transport-control stops

Capture a bounded, credential-free projection of the actual returned control
fields before rejecting a response. A raw-response hash alone cannot explain
a mismatch, and whole-object serialized equality is stronger than validating
the required control semantics.

**Why:** A comparison stopped on the first response's cache-options object.
The response completed and reported zero cache reads and writes, but the
triggering object was not retained. The saved evidence could not distinguish
an incompatible setting from harmless additional/default metadata. Do not
claim the provider used caching merely because this check failed.

**How to apply:** Before another authorized run, offline-test realistic response
metadata and preserve the specific safe values needed to diagnose a stop.
Keep a stopped run's original classification and reservation intact; report
usage-derived token arithmetic separately from unresolved control validation.
Never turn a technically excluded answer into a semantic failure or a model
winner, and never rewrite a frozen global-stop run to erase its failed checks.

Do not assume the current public SDK's response model exhaustively lists fields
that the live endpoint returns. A field missing from the local allowlist is not
necessarily undocumented. A name resembling billing is not proof that prices
or storage changed. Distinguish a demonstrated contract violation, missing
budget evidence, and unresolved additional metadata; do not report them as the
same failure. Arithmetic alone cannot release a reservation while required
control or actual pricing evidence remains unresolved. When usage and applicable
pricing are established and only non-contradictory extra metadata remains,
settle that calculated cost separately from the metadata uncertainty.

**Why:** A subsequent live response included envelope and output metadata not
covered by the archived SDK definitions. Passing offline tests of a minimal
response did not establish compatibility with a complete real envelope.

**How to apply:** Consult the exact nested output type, not only the top-level
response or an input type. Preserve the original stopped ledger and append any
justified accounting correction. Validate a prospective, separately versioned
impact-based continuation before another authorized send.

## Saved content and transport eligibility are separate questions

A parseable saved answer can be assessed against its original source under a
separately authorized content-only diagnosis even if transport metadata remains
unresolved. Preserve the original frozen technical review; append the new
assessment with its narrower scope rather than overwriting that review.

**Why:** A transport gate had marked a source-comparable saved answer entirely
unassessable. The user explicitly requested separating source fidelity from
communication settings and paired-comparison eligibility.

**How to apply:** Verify saved request/source/answer bindings, give a fresh
reviewer only the content evidence, and label hypothetical app-template checks
as hypothetical. Content success does not establish transport clearance,
fairness, clinical quality, or adoption approval.

## Repair-and-resume permission is not a new budget

When the user explicitly requests repair and resumption within existing
ceilings, do not ask them to approve the same execution scope again. Preserve
stopped records and account for continuation separately, inheriting all sent
attempts and unresolved reservations without double-counting usage estimates.

**Why:** A local validation stop does not by itself withdraw the user's remaining
authorization. It also does not establish that an unknown setting is safe or
that an unresolved charge is zero.

**How to apply:** Determine reuse or exclusion from saved control evidence,
before reading answer quality. Resume only with conditions whose meaning can
be established; report unresolved technical blockers as such, not as missing
permission. Excluded cases must not be silently retried to consume a spare slot.
An explicit later no-send/diagnosis-only instruction overrides earlier resume
permission; unused budget or a proposed next request is not authority to send.

## Validator corrections after unmasking

If a local validator defect is discovered after model identities are opened,
keep the frozen primary cohort and reviews unchanged. Apply the diagnostic
uniformly to all saved outputs, and make any new content assessment explicitly
supplementary with fresh, isolated, model-blind reviewers.

**Why:** A secret-prefix detector matched part of a legitimate public citation
identifier. Its generic failure was recorded as invalid answer schema even
though JSON, citation membership and provider completion were valid. Silently
repairing the primary cohort after unmasking would obscure the evaluation order.

**How to apply:** Reproduce the precise validator error before attributing it
to the model. Fix supplementary eligibility from structural evidence before
new scoring; preserve exact answer/source text, report both denominators, and
never treat a local rejection as a demonstrated meaning failure.

Prospective repairs must separate schema, citation membership, secret detection,
and model-identity detection. Exempt only exact request-scoped public IDs, never
an entire answer containing one. Store fixed diagnostic codes rather than parser
messages or matched strings, and keep rejected secret-like text out of persisted
response projections. The defect above showed why a generic schema verdict both
misclassifies valid answers and hides the evidence needed to explain exclusions.

## Private prototype candidacy is not production adoption

Luna is the user's provisional candidate for a private prototype; production
adoption remains on hold. Closing a comparison also closes its authorization:
unused call capacity is not permission for another test.

**Why:** The user explicitly separated a provisional, cost-conscious prototype
choice from adoption, and requested source-grounded parent-question planning and
offline regressions before any further model execution.

**How to apply:** Record candidacy without changing runtime model settings.
Require new explicit permission for further sends. Preserve original errors and
bounded correct interpretations as regression evidence; passing deterministic
claim-level tests or the generating model's own review does not establish that
the model now answers correctly. Parent-facing evaluation must measure direct
answers and understandable wording as well as fidelity, without rewarding
practical advice unsupported by the specified evaluation sources. Permission to
use those sources for a test is not source-adoption approval.

Do not turn a historical AI fail into an unquestionable regression oracle.
Where wording has both a source-contradicting broad reading and a legitimate
limited-uncertainty reading, preserve both and test the distinction.

**Why:** An independent source check can find that a prior grader erased the
difference between known measurement categories and unknown detailed methods.
Overcorrecting that ambiguity would penalize justified caution and fabricate
facts absent from the source.

**How to apply:** Keep the historical verdict, append the qualification, and
review manual claim mappings independently before treating them as test oracles.

## Parent-question stopping behavior is not model output

When a parent-question evaluation routes to clarification or substantive
abstention before generation, do not call the model merely to phrase that stop.
Evaluate the local confirmation/withholding behavior separately from generated
answers. Keep normal-path unapproved-source rejection distinct from an explicitly
authorized, isolated source-reading evaluation.

**Why:** The user requires no-call stops and separate assessment of appropriate
confirmation/withholding, in addition to directness, readability and fidelity.
Otherwise unnecessary calls spend the budget and successful local stops are
misrepresented as evidence of model quality.

**How to apply:** Freeze routing before sends, count only eligible generation
cases toward the new call proposal, and never count a local stop as a Luna answer.
Separate clear errors, genuinely ambiguous readings and minor wording defects;
retain competing reasons when reviewers disagree.

Ask for a fact only when it can change the bounded answer or the individual
applicability judgment actually being made. Do not make diagnosis information a
mandatory prerequisite for describing general research findings. State missing
evidence as a limitation of the retained sources, not of science as a whole.

**Why:** The user explicitly required these distinctions before live evaluation.
Over-collecting health information does not repair a source gap, and a limited
corpus cannot establish that a question is scientifically unresolved.

**How to apply:** Freeze both rules in generation instructions and prospective
grading. Evaluate useful general explanations before optional individual-fit
questions; never promise that more personal information will create unsupported
prescriptions. Preserve unanswered scientific questions as unknown to this
corpus unless the supplied original itself supports a broader claim.

## Source-level display proposal, not question-specific answer cards

The requested direction is a reusable source-level fact projection and common
renderer for numbers, population conditions and attributed recommendation
authority, with AI limited to optional explanation. Only an isolated offline
display pilot is authorized; this does not authorize changing the normal
consultation route, connecting AI explanation, or adopting sources.

**Why:** Correct citation IDs did not prevent wrong aggregation, population
rewriting or invented family attributes. A word blacklist or another AI review
does not establish semantic safety.

**How to apply:** Separate text-match verification from adoption/publication
approval, keep unknown aggregation and population bases explicit, and never
treat a passing manually annotated claim fixture as automatic detection in raw
model prose. Preserve historical outputs/scores and label edited examples.

Separate editorial use restrictions from original research exclusion criteria
when projecting saved units. Do not import unsupplied time/aggregation definitions
from annotations or background knowledge into verified numeric fields.

**Why:** An initial projection supplied a nap-inclusive 24-hour definition absent
from the retained text and mixed editorial restrictions into study exclusions.
Source hashes and shape checks passed; direct source reading caught the errors.

**How to apply:** Review the mapping's meaning separately from quote equality.
A frozen-data hash detects change, not semantic truth; re-sealing a wrong mapping
would remove that protection. Keep source verification and adoption separate.

## Short conclusions in reader previews

When a short conclusion cannot be safely derived from existing validated fields,
label it as an editorial example rather than a completed general answering
capability. Preserve uncertainty as a limit of the retained originals, not a
claim that science has no answer.

**Why:** Readability improvements must not silently introduce interpretation or
turn a display prototype into implied question-answering authority.

**How to apply:** Keep source data and approval state frozen during display edits.
Clearly separate narrow field-based stopping rules from editorial previews.

Keep gap-resolving supplements versioned and linked rather than overwriting an
older source's retained original or its historical unknown state.

**Why:** The source-only result must remain reproducible when a supplemental
link is withdrawn. Draft-deliberation clarification is not adoption of a final
clinical recommendation, and derivative pages sharing an underlying consensus
do not become independent studies.

**How to apply:** Recompute explanations, comparisons and citations together on
link removal. Restrict new support to its authorized population and claim scope;
keep arithmetic, reference comparison and health judgment separate.
