"""Small, single-worker deployment demonstration; no hospital writeback."""

import html
import json
import sqlite3
import uuid
from pathlib import Path


def unreported_cxr(studies, reports):
    """In this curated pack CR/DX are CXR. Any active report excludes a study."""
    active = [r for r in reports if r.get("status") not in ("cancelled", "entered-in-error")]
    result = []
    for study in studies:
        if study.get("status") != "available":
            continue
        if not any(m.get("code") in ("CR", "DX") for m in study.get("modality", [])):
            continue
        study_ref = "ImagingStudy/" + study["id"]
        order_refs = {r["reference"] for r in study.get("basedOn", [])}
        linked = any(
            study_ref in {r["reference"] for r in report.get("imagingStudy", [])}
            or bool(order_refs & {r["reference"] for r in report.get("basedOn", [])})
            for report in active
        )
        if not linked:
            result.append(study)
    return result


class DraftLedger:
    """Persist claims before inference. Uncertain/failed attempts need manual review."""

    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS jobs (job_key TEXT PRIMARY KEY, status TEXT, result TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
            db.execute("INSERT OR IGNORE INTO settings VALUES ('browser_token', ?)", (str(uuid.uuid4()),))

    def browser_token(self):
        with sqlite3.connect(self.path) as db:
            return db.execute("SELECT value FROM settings WHERE key='browser_token'").fetchone()[0]

    def claim(self, job_key):
        with sqlite3.connect(self.path) as db:
            result = db.execute("INSERT OR IGNORE INTO jobs VALUES (?, 'running', NULL)", (job_key,))
            return result.rowcount == 1

    def finish(self, job_key, status, result):
        if status not in ("draft", "needs_review", "skipped"):
            raise ValueError("Unsupported job state")
        with sqlite3.connect(self.path) as db:
            db.execute(
                "UPDATE jobs SET status=?, result=? WHERE job_key=?", (status, json.dumps(result), job_key)
            )

    def rows(self):
        with sqlite3.connect(self.path) as db:
            return [
                {"job_key": key, "status": status, "result": json.loads(result) if result else None}
                for key, status, result in db.execute("SELECT job_key,status,result FROM jobs")
            ]


def arena_draft(result):
    """Parse the verified generate_single Markdown wrapper; reject preview/error responses."""
    if not isinstance(result, (tuple, list)) or len(result) != 2 or not isinstance(result[0], str):
        raise ValueError("Arena response schema changed; review before retrying")
    markdown = result[0]
    if "### Could not generate" in markdown or "[Interface preview" in markdown:
        raise ValueError("Arena returned an error or preview, not a model draft: " + markdown[:500])
    marker = "\n\n---\n\n**Prompt source:**"
    if not markdown.startswith("### ") or marker not in markdown:
        raise ValueError("Arena response wrapper changed; inspect the response")
    body = markdown.split(marker, 1)[0]
    if "\n\n" not in body:
        raise ValueError("Arena returned no report text")
    draft = html.unescape(body.split("\n\n", 1)[1]).strip()
    if not draft:
        raise ValueError("Arena returned an empty report")
    return {
        "draft_text": draft,
        "arena_markdown": markdown,
        "status": "awaiting_radiologist_review",
        "clinical_context_sent": False,
        "prompt_policy": "canonical",
    }


def submit_to_arena(image_path, model_id, browser_token, timeout=300):
    """Upload a PNG, using a separate client with no hospital token or report text."""
    from gradio_client import Client, handle_file

    arena = Client("eduardofarina/radiology-arena", verbose=False, httpx_kwargs={"timeout": 120})
    job = arena.submit(
        image=handle_file(str(image_path)),
        model_id=model_id,
        selected_prompt_policy="canonical",
        browser_token=browser_token,
        api_name="/generate_single",
    )
    # Timeout may mean the backend still runs. The ledger prevents automatic resubmission.
    return arena_draft(job.result(timeout=timeout))
