"""Adapted from Imon Banerjee, RSNA 2026 Lab 08 PR #11 (c0a58b1)."""

import html
import re
import base64
import pandas as pd


def evaluate_report_matches(study, reports):
    """
    Compare candidate radiology reports against a selected ImagingStudy.
    """

    candidates = reports[reports["patient_id"] == study["patient_id"]].copy()

    # Convert times
    study_time = pd.to_datetime(study["study_datetime"], utc=True)

    candidates["report_datetime"] = pd.to_datetime(candidates["report_datetime"], errors="coerce", utc=True)

    # --------------------------------------------------------
    # Matching criteria
    # --------------------------------------------------------

    candidates["accession_match"] = candidates["accession_number"].fillna("").astype(str) == str(
        study["accession_number"]
    )

    candidates["order_match"] = candidates["service_request_id"].fillna("").astype(str) == str(
        study["service_request_id"]
    )

    candidates["encounter_match"] = candidates["encounter_id"].fillna("").astype(str) == str(
        study["encounter_id"]
    )

    candidates["modality_match"] = candidates["modality"].fillna("").astype(str) == str(study["modality"])

    # --------------------------------------------------------
    # Temporal distance
    # --------------------------------------------------------

    candidates["time_difference_hours"] = (
        candidates["report_datetime"] - study_time
    ).abs().dt.total_seconds() / 3600

    # --------------------------------------------------------
    # Define the high-confidence match
    # --------------------------------------------------------

    candidates["matched"] = (
        candidates["accession_match"]
        & bool(str(study["accession_number"] or "").strip())
        & bool(str(study["service_request_id"] or "").strip())
        & candidates["order_match"]
    )

    # Sort best candidates first
    candidates = candidates.sort_values(
        by=[
            "matched",
            "accession_match",
            "order_match",
            "encounter_match",
            "modality_match",
            "time_difference_hours",
        ],
        ascending=[False, False, False, False, False, True],
    )

    return candidates


def classify_match(row):
    if row["matched"]:
        return "MATCH"

    elif row["encounter_match"] and row["modality_match"]:
        return "POSSIBLE DISTRACTOR"

    else:
        return "NON-MATCH"


def extract_report_section(text, section="FINDINGS"):
    """Imon's section extraction, retaining organ subheadings within Findings."""
    if text is None or pd.isna(text):
        return None
    headings = r"EXAM|CLINICAL HISTORY|HISTORY|COMPARISON|TECHNIQUE|FINDINGS|IMPRESSION|CONCLUSION|RECOMMENDATIONS|ADDENDUM"
    # Require a colon or newline on terminating headings, while permitting inline headings.
    pattern = (
        rf"(?:^|\n)[ \t]*{re.escape(section)}(?:[ \t]*\(preliminary\))?[ \t]*(?::|\n)[ \t\r\n]*"
        rf"(.*?)(?=\n[ \t]*(?:{headings})[ \t]*(?::|\n)|\Z)"
    )
    match = re.search(pattern, str(text), flags=re.IGNORECASE | re.DOTALL)
    return match.group(1).strip() if match else None


def clean_report_text(text):
    if text is None or pd.isna(text):
        return None
    text = html.unescape(str(text)).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def fhir_report_rows(reports):
    """Translate standard FHIR fields to Imon's original exercise columns."""
    rows = []
    for report in reports:
        accession = next(
            (i["value"] for i in report.get("identifier", []) if i.get("system", "").endswith("/accession")),
            "",
        )
        modality = next(
            (
                c["code"]
                for cat in report.get("category", [])
                for c in cat.get("coding", [])
                if c.get("system") == "http://dicom.nema.org/resources/ontology/DCM"
            ),
            "",
        )
        rows.append(
            {
                "report_id": report["id"],
                "patient_id": report.get("subject", {}).get("reference", "").removeprefix("Patient/"),
                "accession_number": accession,
                "service_request_id": next(
                    (
                        r["reference"].removeprefix("ServiceRequest/")
                        for r in report.get("basedOn", [])
                        if r.get("reference", "").startswith("ServiceRequest/")
                    ),
                    "",
                ),
                "encounter_id": report.get("encounter", {}).get("reference", "").removeprefix("Encounter/"),
                "report_datetime": report.get("issued", report.get("effectiveDateTime")),
                "modality": modality,
                "exam_name": report.get("code", {}).get("text", ""),
                "report_text": base64.b64decode(report["presentedForm"][0]["data"]).decode(),
            }
        )
    return pd.DataFrame(
        rows,
        columns=[
            "report_id",
            "patient_id",
            "accession_number",
            "service_request_id",
            "encounter_id",
            "report_datetime",
            "modality",
            "exam_name",
            "report_text",
        ],
    )
