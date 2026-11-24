"""Transparent helpers for image/report pairs. No model or GPU required."""

import base64
import hashlib
import re
from collections import defaultdict


def normalize_report(report):
    text = base64.b64decode(report["presentedForm"][0]["data"]).decode("utf-8")
    # Only remove the explicitly synthetic identifier fields in this teaching corpus.
    text = re.sub(r"(?im)^\s*(?:Patient|MRN|Accession):[^\n]*\n?", "", text)
    text = re.sub(r"(?im)^findings(?: \(preliminary\))?:", "FINDINGS:", text)
    text = re.sub(r"(?im)^(?:impression|conclusion):", "IMPRESSION:", text)
    text = "\n".join(re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines())
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def assemble(resources):
    reports = defaultdict(list)
    for r in resources:
        if r["resourceType"] == "DiagnosticReport" and r["status"] in ("final", "amended", "corrected"):
            for ref in r.get("imagingStudy", []):
                reports[ref["reference"]].append(r)
    rows = []
    excluded = []
    for study in (r for r in resources if r["resourceType"] == "ImagingStudy"):
        candidates = reports["ImagingStudy/" + study["id"]]
        if not candidates:
            excluded.append({"study_id": study["id"], "reason": "no finalized report"})
            continue
        report = max(candidates, key=lambda r: (r.get("issued", ""), r["id"]))
        if report["subject"] != study["subject"]:
            excluded.append({"study_id": study["id"], "reason": "patient mismatch"})
            continue
        patient = study["subject"]["reference"]
        bucket = int(hashlib.sha256(patient.encode()).hexdigest()[:8], 16) % 10
        rows.append(
            {
                "patient_id": patient,
                "study_id": study["id"],
                "study_uid": study["identifier"][0]["value"].removeprefix("urn:oid:"),
                "report_id": report["id"],
                "report_status": report["status"],
                "target": findings_only(normalize_report(report)),
                "split": "test" if bucket == 0 else "validation" if bucket == 1 else "train",
                "synthetic_report": True,
            }
        )
    return rows, excluded


def findings_only(text):
    """Extract the labeled findings section; reject unlabeled reports for review."""
    match = re.search(
        r"(?ims)^\s*findings(?:\s*\(preliminary\))?\s*:\s*(.*?)"
        r"(?=^\s*(?:impression|conclusion|recommendations|addendum)\s*:|\Z)",
        text,
    )
    if not match or not match.group(1).strip():
        raise ValueError("No labeled findings section; review this report manually")
    return " ".join(match.group(1).split())


def age_at_study(birth_date, study_date):
    """Calculate completed years at acquisition, retaining missing/partial dates."""
    from datetime import date

    if not birth_date or len(birth_date) != 10:
        return None
    birth = date.fromisoformat(birth_date)
    acquired = date.fromisoformat(study_date[:10])
    if acquired < birth:
        raise ValueError("Study date precedes birth date")
    return acquired.year - birth.year - ((acquired.month, acquired.day) < (birth.month, birth.day))


def prepare_cxr(ds, max_side=896, window=None):
    """Single-frame grayscale teaching pipeline; window=(center,width) is optional."""
    import numpy as np
    from PIL import Image
    from pydicom.pixels import apply_modality_lut, apply_voi_lut

    if max_side < 1:
        raise ValueError("max_side must be positive")
    raw = ds.pixel_array
    if raw.ndim != 2 or ds.PhotometricInterpretation not in ("MONOCHROME1", "MONOCHROME2"):
        raise ValueError("This exercise expects a single-frame grayscale radiograph")
    valid = np.isfinite(raw)
    if "PixelPaddingValue" in ds:
        low = float(ds.PixelPaddingValue)
        high = float(ds.get("PixelPaddingRangeLimit", low))
        valid &= (raw < min(low, high)) | (raw > max(low, high))
    pixels = apply_modality_lut(raw, ds).astype(float)
    valid &= np.isfinite(pixels)
    if not valid.any():
        raise ValueError("No usable pixels")
    if window is not None:
        center, width = window
        if not np.isfinite([center, width]).all() or width <= 0:
            raise ValueError("Window width must be positive and values finite")
        # Explicit linear teaching window, distinct from DICOM's LINEAR formula.
        low, high = center - width / 2, center + width / 2
        method = "manual linear window"
    elif "VOILUTSequence" in ds or ("WindowCenter" in ds and "WindowWidth" in ds):
        pixels = apply_voi_lut(pixels, ds).astype(float)
        if "VOILUTSequence" in ds:
            low, high = 0, 2 ** int(ds.VOILUTSequence[0].LUTDescriptor[2]) - 1
        else:
            # pydicom windowing output spans the modality-transformed bit range.
            bits = int(ds.BitsStored)
            low, high = (
                (0, 2**bits - 1) if ds.PixelRepresentation == 0 else (-(2 ** (bits - 1)), 2 ** (bits - 1) - 1)
            )
            if "ModalityLUTSequence" in ds:
                low, high = 0, 2 ** int(ds.ModalityLUTSequence[0].LUTDescriptor[2]) - 1
            else:
                slope, intercept = float(ds.get("RescaleSlope", 1)), float(ds.get("RescaleIntercept", 0))
                low, high = sorted((low * slope + intercept, high * slope + intercept))
        method = "DICOM VOI LUT/window (first preset)"
    else:
        low, high = np.percentile(pixels[valid], [0.5, 99.5])
        method = "0.5–99.5 percentile fallback"
    pixels = np.clip((pixels - low) / max(float(high - low), 1e-8), 0, 1)
    if ds.PhotometricInterpretation == "MONOCHROME1":
        pixels = 1 - pixels
    pixels[~valid] = 0
    image = Image.fromarray(np.rint(pixels * 255).astype("uint8"))
    original_size = image.size
    image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return image, {
        "original_size": original_size,
        "output_size": image.size,
        "intensity_method": method,
        "max_side": max_side,
    }
