# Private material-selection preview

This successor reuses the existing four sources / eleven units, vocabulary and
five fact projections. It does not edit frozen implementations, normal routes,
source approvals or an existing DB. The two narrow connection adaptations are
candidate-only projection and comparison authorization for an explicitly selected
child group. Topic selection selects displayed materials, not question adequacy.

## Start the private interactive preview

From the project root, use the Replit **VNC** workflow named `資料操作プレビュー`
with this command (no HTTP port or public development URL):

```
env -i PATH="$PATH" LANG=C.UTF-8 TZ=UTC \
 node --import ./prototypes/evidence-consultation/material-selection-preview/register-live.mjs \
 --import tsx tests/run-ephemeral-tests.mjs material-selection-live
```

The owner creates a new PostgreSQL cluster and the managed child opens an offline
headed Chromium on workspace display `:0`. No existing database URL is accepted.
Use the workspace's native VNC display, not external noVNC or a public URL.
Workspace collaborators may see that display: it is not a confidential service.
Use fictional consultations only.

Readiness is written under the new timestamped
`evidence-work/parent-reading-evaluation/material-selection-preview-01/preview-*/ready.json`.
The managed runner does not forward arbitrary child stdout, so readiness must not
be inferred from a console marker alone. Ready/closed files contain lifecycle
metadata only, never consultation text, entered ages or sleep values.

## Try it

1. Enter a fictional consultation, target and age. A material topic can optionally
   be selected at the top. Confirm the input and search.
2. If needed, choose a topic in the single material selector and press
   **選んだ資料を表示**. **該当しない** and **言い直す** remain available.
3. For sleep material, entering sleep values alone does not compare anything.
   Supply only the missing fields/conditions, then press
   **入力した睡眠時間を目安と比べる** for the intended child.
4. Read the used age, night/nap/total hours and aggregation conditions alongside
   the result. This is not an answer to the original consultation or a diagnosis.
5. Editing sleep inputs removes only the old comparison; materials remain and do
   not require topic selection again. Editing the consultation, target or age
   invalidates the old selection and result.

## End

Use **プレビューを終了** in the VNC window, close that browser, or run:

```
env -i PATH="$PATH" node prototypes/evidence-consultation/material-selection-preview/stop-preview.mjs
```

The command writes a graceful-stop marker only to this prototype's active
sessions; it does not kill unrelated processes. The browser and pool close, the
managed child exits, and the original owner removes its cluster. The preview also
ends automatically after 60 minutes. A workflow Stop/SIGTERM is handled by the
same owner, but is reported as an interrupted run; prefer the UI or graceful-stop
command for a normal exit. Do not create another preview while one is still
active. Restart after a completed stop to get an empty session.

`closed.json` reports child cleanup honestly. Verify the outer runner's
`ephemeral cleanup: complete` before claiming that PostgreSQL cleanup is complete.
Browser-close failure does not skip pool closure or temporary-directory removal.

## Verification

```
env -i PATH="$PATH" LANG=C.UTF-8 TZ=UTC \
 node --import ./prototypes/evidence-consultation/material-selection-preview/register.mjs \
 --import tsx tests/run-ephemeral-tests.mjs material-selection-preview
```

The earlier frozen 12 cases are reused. Their only intentional expectation
change is that material selection never performs a personal comparison; a
separate explicit operation may do so. Focused checks cover a single chooser,
upfront selection, mixed text, sibling isolation, stale values, request races,
independent cleanup, and actual headful startup. Attempts are append-only.
No new dictionary, classifier, source, fact or model call is introduced.

Limit: the user can choose materials unrelated to their original consultation.
That is allowed as a display choice, not claimed as a successful answer. A
separate explicit comparison likewise evaluates the entered fictional numbers
against a reference, not whether the original consultation has been answered.