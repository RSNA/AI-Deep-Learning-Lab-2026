# Integrating Imon Banerjee's report-matching exercise

Source: [RSNA PR #11](https://github.com/RSNA/AI-Deep-Learning-Lab-2026/pull/11),
`Banerjee_NLP.ipynb` and its two synthetic CSVs, revision
`c0a58b161b54e54a475a5258526998619f9e81d8`, authored by Imon Banerjee.

## One continuous patient workflow

The main notebook uses sections 1–6 for clinical sourcing, sections 7–9 for Imon's matching/curation
exercise and DICOMweb retrieval, and sections 10–12 for image preprocessing and the final training pair.
Participants do not switch notebooks or upload CSV files. The RIS reads the original CSVs during seeding
and serves their adapted records through the existing authenticated FHIR R4 routes.

The two original CSVs are preserved unchanged in the hospital authoring repository under `hospital/ris-source/`.
They are backend fixtures, not a participant download. `hospital/ris.py` documents the deterministic mapping.

## Mapping to the actual PACS

The original exercise selects a chest CT. To preserve this lab's CXR goal, we instead use the source CXR
row `ACC-2026-00144` / `SR-1044`, whose report is `RPT-2003`. It maps to:

| CSV field | Live teaching record |
| --- | --- |
| PAT-001 | Patient/pat-001 (John Parker) |
| SR-1044 | ServiceRequest/order-001 |
| ENC-501 | Encounter/enc-001 |
| ACC-2026-00144 | ACC00001, also present in the DICOM header |
| Source CXR study UID | The existing StudyInstanceUID of ImagingStudy/study-001 in Orthanc |
| RPT-2003 | DiagnosticReport/report-001; original source ID retained as an identifier |
| DX | CR, matching the actual teaching DICOM modality |

The selected CXR report retains the hospital's existing label-derived Findings and Impression, rather than
attaching the source CSV's clinical assertions or two-view acquisition description to an unrelated image.
This is a documented teaching-data adaptation, not evidence that the original report describes our image.
The remaining nine report texts are unchanged distractors. Dates are shifted consistently relative to the
selected CXR; historical encounters/orders are distinct. The three other CSV ImagingStudy records are
`registered`, with zero imported series/instances and an explicit RIS-only description. Their source UIDs
are not claimed to exist in Orthanc. Other report-only historical examinations have no invented image link.

## Preserved teaching logic and bounded fixes

- Imon's dataframe columns, accession + ServiceRequest match criterion, encounter/modality checks,
  temporal distance, ranking and MATCH / POSSIBLE DISTRACTOR / NON-MATCH labels are retained.
- A small adapter translates DiagnosticReport identifier, basedOn, encounter, category and presentedForm
  fields into those columns. The report text does not determine the linkage.
- Empty accession/order values cannot produce a positive match. Dates are parsed with explicit UTC handling.
- Before selecting the report, the notebook additionally verifies finalized/corrected/amended status and
  the exact FHIR ImagingStudy reference. It selects the latest issued version, but abstains on a tie.
- Imon's section extraction and whitespace/HTML cleanup remain recognizable. The extractor stops at known
  report sections rather than every uppercase heading, preserving organ subheadings inside Findings.
  The required `html` import is included. Negation and uncertainty remain intact.
- Only Findings becomes the target. Clinical context is obtained from the patient/order/encounter,
  independently of the completed report; Impression is neither model input nor target.
- After WADO retrieval, the notebook checks the actual DICOM patient's MRN, accession and UIDs before
  preprocessing the image. Missing or ambiguous matches require review.

The original CSV data and adapted records remain synthetic. The image sources are separately attributed
in [assets/ATTRIBUTION.md](assets/ATTRIBUTION.md). The optional Arena demonstration remains in the
complementary notebook; its image-only endpoint does not receive clinical context or hospital credentials.
