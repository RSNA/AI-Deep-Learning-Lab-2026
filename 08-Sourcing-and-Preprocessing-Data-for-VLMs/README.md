# Lab 08: An Introduction to Sourcing and Preprocessing Medical Imaging Data for Vision-Language Models

**RSNA 2026 Deep Learning Lab**

| | |
| --- | --- |
| **Date** | Wednesday, December 2, 2026 |
| **Time** | 9:30 – 10:30 AM (U.S. Central Time) |
| **Level** | Core |

> Dates and times may change. Please check the official RSNA 2026 Annual Meeting program for the latest schedule.

## Faculty

- **Moderator:** Felipe Kitamura, MD PhD — Eden
- **Presenter:** Imon Banerjee, PhD — Mayo Clinic
- **Presenter:** Eduardo Farina, MD — Federal University of São Paulo (UNIFESP)
- **Presenter:** Alessia Guarnera, MD, PhD — UniCamillus, Rome, Italy

## Overview

This interactive workshop focuses on the "data-first" engineering required to build medical imaging datasets from the ground up. The session goes beyond model training to teach the foundational skills of a medical AI researcher: selecting a cohort from EHR and radiology report data, fetching studies via DICOM networking (pynetdicom), and implementing professional anonymization and quality control pipelines.

The workshop runs in a Colab notebook using public data and guides participants through transforming raw clinical inputs into structured, de-identified image-report pairs optimized for vision-language model (VLM) training. Attendees will leave with a framework for clinical data orchestration that can be adapted to any institution or research use case.

## Learning Objectives

By the end of this session, participants will be able to:

1. Demonstrate how to programmatically identify and select clinical cohorts by querying EHR databases and radiology reports, integrating disparate data sources into a unified research pipeline.
2. Execute end-to-end imaging retrieval and sanitization using pynetdicom for PACS communication and DICOM de-identification protocols to ensure HIPAA compliance.
3. Synthesize image-text pairs by applying NLP-based anonymization to free-text reports and synchronizing them with the corresponding imaging volumes.

## Materials

Materials for this lab will be posted here before the meeting.

# Lab 08: An Introduction to Sourcing and Preprocessing Medical Imaging Data for Vision-Language Models

**RSNA 2026 Deep Learning Lab**

| | |
| --- | --- |
| **Date** | Wednesday, December 2, 2026 |
| **Time** | 9:30 – 10:30 AM (U.S. Central Time) |
| **Level** | Core |

> Dates and times may change. Please check the official RSNA 2026 Annual Meeting program for the latest schedule.

## Faculty

- **Moderator:** Felipe Kitamura, MD, PhD — Eden
- **Presenter:** Imon Banerjee, PhD — Mayo Clinic
- **Presenter:** Eduardo Farina, MD — Federal University of São Paulo (UNIFESP)
- **Presenter:** Alessia Guarnera, MD, PhD — UniCamillus, Rome, Italy



## Overview: Imon Banerjee

Building a medical vision-language model starts long before model training.

This interactive lab introduces the **data-first workflow** required to transform clinical and imaging data into curated image-text pairs suitable for medical AI development.

Participants will follow a patient-centered workflow beginning with clinical data discovery using **FHIR**, identify the appropriate imaging study and associated order/encounter context, match the study to the correct radiology report, extract relevant report sections, retrieve the corresponding imaging data using **DICOMweb**, and preprocess the images for downstream multimodal modeling.

A particular focus of the lab is **data linkage and provenance**. Participants will work through realistic examples in which a patient has multiple imaging examinations and radiology reports—including chest CT, abdominal CT, chest radiography, and mammography—and learn why temporal proximity or textual similarity alone is insufficient to establish the correct image-report pair.

By the end of the lab, participants will assemble a structured multimodal example containing the clinical context, imaging identifiers, curated report text, and processed image that could serve as input to a vision-language model training pipeline.

## Learning Objectives

By the end of this session, participants will be able to:

1. **Source clinical and imaging context using FHIR**, including patient, ImagingStudy, ServiceRequest/order, and Encounter resources.

2. **Match imaging studies to the appropriate radiology reports** using structured identifiers such as accession numbers, orders, encounters, modality, and temporal information, while recognizing ambiguous or incorrect matches.

3. **Extract and curate clinically relevant report sections**, such as Findings and Impression, for construction of image-text training pairs.

4. **Retrieve medical images using DICOMweb**, including QIDO-RS for study/series discovery and WADO-RS for image retrieval.

5. **Preprocess and inspect medical images** and combine imaging, report, and provenance information into a structured multimodal dataset suitable for VLM development.

## Lab Workflow

The notebook follows the clinical data pathway from source systems to a model-ready example:

```text

FHIR clinical context
   ↓
ImagingStudy
   ├── ServiceRequest / Order
   └── Encounter
   ↓
Candidate radiology reports
   ↓
Report–study matching
   ├── Accession number
   ├── ServiceRequest / Order
   ├── Encounter
   ├── Modality
   └── Temporal proximity
   ↓
Report curation
   ├── Findings
   └── Impression
   ↓
Structured image–text pair
   ↓
VLM-ready dataset
```

## Hands-on Components

### Clinical Data Sourcing

Participants will explore how FHIR resources can be used to reconstruct the clinical context surrounding an imaging examination.

This includes:

- Patient identification
- ImagingStudy selection
- ServiceRequest/order linkage
- Encounter information
- Study metadata

### Report–Study Matching

Participants will work with a synthetic collection of radiology reports representing multiple examinations for the same patient.

The candidate reports include:

- Chest CT
- CT abdomen/pelvis
- Chest radiograph
- Mammography
- Prior and follow-up examinations

Participants will determine which report corresponds to a selected ImagingStudy and examine why apparently reasonable alternatives are incorrect.

The exercise demonstrates an important principle:

> **Clinical similarity is not data linkage.**

A report describing the same anatomy or abnormality—or even a report generated during the same encounter—does not necessarily correspond to the selected imaging study.

### Report Curation

After identifying the appropriate report, participants will extract clinically relevant sections such as:

- Clinical History
- Comparison
- Technique
- Findings
- Impression

The lab will also discuss how the choice of report content depends on the downstream modeling task and how inappropriate inclusion of clinical context can introduce information leakage.

### Assemble a VLM-Ready Example

The final exercise combines the curated information into a traceable multimodal record containing fields such as:

```python
{
    "patient_id": "...",
    "study_uid": "...",
    "accession_number": "...",
    "report_id": "...",
    "service_request_id": "...",
    "modality": "...",
    "study_datetime": "...",
    "match_method": "accession+service_request",
    "match_status": "HIGH_CONFIDENCE",
    "findings": "...",
    "image": "..."
}
```

Rather than producing only an image and a text label, this structure preserves the **provenance of the image-report relationship**, allowing the resulting dataset to be audited and quality controlled.

## Materials

| Material | Description |
| --- | --- |
| `Banerjee_NLP.ipynb` | Hands-on notebook for report–study matching and report curation |
| `synthetic_radiology_reports.csv` | Synthetic candidate radiology reports used in the matching exercise |
| `synthetic_imaging_studies.csv` | Synthetic ImagingStudy metadata used in the matching exercise |

Once the notebook is available in the repository:

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/RSNA/AI-Deep-Learning-Lab-2026/blob/main/08-Sourcing-and-Preprocessing-Data-for-VLMs/Banerjee_NLP.ipynb)

## Before the Session

- Bring a laptop with a recent version of the [Chrome browser](https://www.google.com/chrome/).
- Make sure you can sign in to a Google account to run the notebook in [Google Colab](https://colab.research.google.com/).
- No institutional clinical data or credentials are required for the synthetic report–study matching exercise.

---

[← Back to all labs](../README.md)

## Before the Session

- Bring a laptop with a recent version of the [Chrome browser](https://www.google.com/chrome/).
- Make sure you can sign in to a Google account, which you need to run notebooks in [Google Colab](https://colab.research.google.com/).

---

[← Back to all labs](../README.md)
