# Instructor guide — a chest X-ray report assistant

## Learning problem

Prepare examples for a VLM that receives a chest radiograph, age at examination, administrative gender and
reason for visit, and drafts only the **findings**. Impression text is neither input nor target.
We teach data acquisition and preparation, not model training or clinical performance evaluation.

## Proposed faculty handoffs — December 2, 2026

| Time (Central) | Lead | Content |
|---|---|---|
| 9:30–9:35 | Felipe | Introduction and setup |
| 9:35–9:50 | Eduardo | Sections 1–6: FHIR and clinical context |
| 9:50–10:05 | Imon | Sections 7–9: RIS report matching, Findings curation and QIDO/WADO |
| 10:05–10:20 | Alessia | Sections 10–12: pixels, visual inspection, training pair; cohort if time permits |
| 10:20–10:30 | Felipe | Questions, troubleshooting and catch-up |

One notebook and one kernel throughout. Begin setup during the introduction; omit the cohort exercise
if delays accumulate. Arena stays in the independent complementary notebook.
See [integration notes](report-matching-notes.md) for Imon's CSV-to-FHIR adaptation.
In section 8, compare the original portable CXR (RPT-2006), CT (RPT-2001) and mammography (RPT-2004)
reports. Ask which headings delimit sections versus remain inside Findings. Highlight CT organ headings,
RIGHT/LEFT BREAST, separate Breast Composition and BI-RADS, and preserved uncertainty. These are text-only
examples already in the RIS; the PACS has no mammograms, and these original reports are not paired to
its images. Resume study-001 for DICOMweb. Keep this within Imon's 15-minute block; skip the optional cohort
if discussion runs long.

## Teaching choices

One case is shown before loops or generalization. The multipart and image-processing helpers are collapsed
in Colab; run them once and expand only if useful. The notebook is self-contained, including its guide image.
Two embedded recovery points restore one matched clinical case and its DICOM without server access.
They let a participant resume report/image processing; the cohort still needs the hospital. There is no
full offline ZIP workflow. The hospital snapshot remains an operations artifact.
Local pynetdicom, CT localizers, MRI sequence selection and UID remapping belong in optional future material,
not this beginner core. No small language model is needed to split the known report sections.

`Patient.gender` is administrative gender, not biological sex. Unknown stays unknown. Age uses the examination
date; partial birth dates produce unknown age. Context is invented independently of the image label/report.
`Encounter.reasonCode` supplies the visit reason; `ServiceRequest.reasonCode` supplies the examination indication.
They match in this pack for simplicity. Do not derive the indication from a completed report in a real training pipeline.

FHIR searches return Bundles, resource reads return resources, and DICOMweb searches return DICOM JSON.
The early patient-specific examples use one page in this fixed small pack; the cohort helper follows next links.
The selected CXR examples have one series and one instance. Generalizing requires an explicit view selection policy.

The target extraction requires a Findings heading and stops at Impression/Conclusion/Recommendations/Addendum.
It preserves negation and uncertainty. Unknown templates are rejected for review, not silently used as targets.

Image preprocessing applies modality transformation before VOI/windowing, handles MONOCHROME1 and padding,
and uses a 0.5–99.5 percentile fallback only when no VOI/window is provided. The optional manual window is an
explicit linear contrast experiment. The 896-pixel maximum is an adjustable classroom budget, not a model
specification or a guarantee of preserved diagnostic detail. Inspect the chosen model processor before training.

## Expected cases

- study-001: first walkthrough; John Parker also has study-024.
- study-002: preliminary and corrected reports; select the corrected report.
- study-004: no finalized report; skip with a visible reason.
- study-024: intentionally duplicates study-001 pixels; use later for duplicate/split discussion.
- CT/MR remain in the hospital but are outside today's cohort.

The selected four-study loop exports three CXR examples and records the missing report case.
The loader returns PIL RGB images, prompt and target. Model tensor processing, collation and QLoRA remain a later extension.

## Rehearsal and remaining work

Run `python tools/verify_notebook.py` against the seeded local hospital. Rehearse in a fresh Colab runtime once
the HTTPS host is available. Test a revoked token and a stopped host; verify the two recovery points can resume the single-case workflow.
Review every image and report template before public release. Add concise facilitator slides, rehearse the existing cohort exercise, then
benchmark a selected MedGemma processor/collator and optional training run near the event.

Freeze the final materials by November 15, 2026. Preserve upstream faculty and scheduling information during export.
Keep the repository, clinical pack, credentials and review material private until publication is approved.

## Complementary material and access

`02_complementary.ipynb` initializes its own client and reconstructs the original case/cohort in a fresh
kernel. It does not require saved variables or files from the main notebook. It includes the window experiment,
loader, duplicate/split example and Arena polling/inference sections. Arena is entirely post-session content;
do not reserve a live demonstration slot in the required hour.

Plan to keep the hospital available from faculty review before November 15, 2026 through **March 2, 2027**
(about three months after the December 2 session). The token generator now defaults to expiration at the end
of March 2 in Chicago. Existing issued tokens are not automatically replaced or extended; update their expiry
when provisioning the event environment, preserving token hashes and revocations. Hosting and inference
capacity still require rehearsal; this access plan does not provision or purchase infrastructure.

Arena availability and quota are separate from hospital access. Its last inspected public API used an image-only
fixed prompt and external inference had not been validated successfully. Recheck before promising it for
independent practice. Drafts remain separate from finalized hospital reports. See the deployment guide.
