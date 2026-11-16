# Deployment extension: an unreported CXR becomes an AI draft

This is the optional deployment section of `notebooks/02_complementary.ipynb` (retaining original sections 14–16 for reference). It connects the data lesson to an
inference workflow using the existing Radiology Arena. It does not deploy a new model or start a background service.

## Sequence

1. Poll the hospital's FHIR ImagingStudy and DiagnosticReport searches, following every page.
2. Select available CR/DX studies with no active report linked by study or order reference.
3. Retrieve DICOM through QIDO/WADO and reuse the 896-pixel preprocessing pipeline.
4. Claim a job in a persistent SQLite ledger before submitting the PNG.
5. Recheck for a newly available report, then request one model's canonical findings draft from Arena.
6. Save the draft, model ID, image hash, preprocessing settings and raw Arena response for review.
7. On the next polling pass, skip jobs already attempted. A failed or interrupted attempt needs inspection.

“Unread” is a teaching shorthand for no linked active report. It does not establish actual reading status.
Preliminary, partial and registered reports exclude a study as well as finalized reports. Cancelled or
entered-in-error reports do not exclude it. All CR/DX in this pack are CXR; production needs a chest-specific
procedure or body-site filter, not modality alone.

## Verified Arena contract

Inspected September 21, 2026, at Space revision `b6d028087c766a4134940ead8e5078134796e881`:

- [Public API schema](https://eduardofarina-radiology-arena.hf.space/gradio_api/info)
- [UI source](https://huggingface.co/spaces/eduardofarina/radiology-arena/blob/b6d028087c766a4134940ead8e5078134796e881/radarena/ui.py)
- [Prompt definitions](https://huggingface.co/spaces/eduardofarina/radiology-arena/blob/b6d028087c766a4134940ead8e5078134796e881/radarena/prompts.py)

`/generate_single` takes `image`, `model_id`, `selected_prompt_policy`, and `browser_token`.
The browser token is a stable anonymous UUID used by Arena; it is not the FHIR credential. No hospital
headers are forwarded. The selected example model is `chexone`, with policy `canonical`.
The endpoint returns Markdown (model link, report, prompt provenance) and the anonymous UUID.
The adapter rejects explicit inference errors and preview outputs and preserves the original Markdown.

The public endpoint accepts PNG/JPEG and a fixed prompt policy. It does not accept a custom prompt or
clinical context. This demonstration is image-only; age, administrative gender and visit reason stay
local. A context-aware model endpoint is a separate future integration. The returned prose is a draft;
a prompt requesting findings only does not guarantee that every model obeys it.

## Run and verify

The normal notebook run scans and prepares the image without sending it externally. For the optional
instructor demonstration set `RUN_ARENA = True`; it installs the pinned lightweight Gradio client.

Use the prepared public teaching images after instructor pixel review, not clinical patient images.
The prepared PNG carries no DICOM metadata, but removing tags is not a burned-in text detector.
Do not upload reference reports or identifiers. Inference may queue, exhaust quota or fail; do not
replace a failure with a placeholder report. Inspect `artifacts/02_complementary/inference/jobs.sqlite` after failure
before manually deciding whether another request is appropriate.

## Scheduler versus listener

The notebook's `RUN_SCHEDULER_DEMO` is a bounded three-pass loop at one-minute intervals, disabled by default.
It demonstrates the control flow without leaving a permanent job running. A real deployment runs the
worker in a server process or container with persistent state, independent of a Colab runtime. A timer
can launch one scan per minute; an image-arrival listener can enqueue the same unit of work. Our hospital
implements neither FHIR Subscriptions nor PACS event callbacks, so those are explained rather than invented.

For the event-sized hospital, one read-only poller and SQLite are sufficient for demonstrating job tracking.
Production requires a queue, scoped incremental searches, reconciliation for missed events, bounded retries,
image/view completeness checks and a review workflow. Keep the hospital and inference credentials separate.
The claim-before-submit design prevents automatic duplicate attempts; it cannot guarantee exactly-once
remote inference if a connection breaks. Do not automatically reset stale running or failed jobs.

No DiagnosticReport is written back. Even if a human report appears during inference, the output remains
an AI draft with that race recorded, never a finalized report or an overwrite of the radiologist's work.

## Current rehearsal result

The local scan/preprocessing/default notebook run passes. The September 21 external test did not yield a
validated draft: MedGemma's backend requested 270 seconds of GPU beyond its allowed maximum, and a CheXOne
request hit a write timeout. The adapter now sets a longer explicit HTTP timeout, but a successful live
rehearsal is still required. Both failed attempts remain recorded for review; no automatic resubmission occurs.

October 13 follow-up: the complementary notebook reached CheXOne but received a GPU-duration-limit error (270 seconds requested). No model draft was accepted. This remains optional, unvalidated external inference.
