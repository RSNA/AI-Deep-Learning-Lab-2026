"""Merge pull requests from lab presenters automatically.

Runs in GitHub Actions for the RSNA 2026 Deep Learning Labs. It never checks
out or runs code from a pull request. It only reads metadata through the
GitHub API and decides from two things: who the author is, and which file
paths change.

A pull request is merged only if all of these hold:
  1. It is open, targets main, and is not a draft.
  2. Every changed file is inside exactly one lab folder (NN-Name/).
  3. The author is a presenter of that lab (see is_presenter), or a
     maintainer added the APPROVAL_LABEL label to the pull request.
  4. GitHub reports no merge conflicts.
  5. The author is not the lab director, who merges his own pull requests.

Everything else is left untouched for the director to decide.
"""

import json
import os
import re
import subprocess
import sys
import time
import unicodedata

REPO = os.environ.get("GITHUB_REPOSITORY", "RSNA/AI-Deep-Learning-Lab-2026")
DRY_RUN = os.environ.get("DRY_RUN") == "1"
# For local tests: comma-separated pull request numbers to evaluate (any state)
ONLY = [int(n) for n in os.environ.get("PR_NUMBERS", "").split(",") if n.strip()]

DIRECTOR = "pouriarouzrokh"
APPROVAL_LABEL = "merge-approved"
LAB_FOLDER = re.compile(r"^\d{2}-[^/]+$")

# GitHub accounts already confirmed as presenters: login -> lab numbers
KNOWN_PRESENTERS = {
    "f10409": {"03"},  # Frank Li
    "imonban": {"08"},  # Imon Banerjee
    "eduardofarina": {"08"},  # Eduardo Farina
}

DEGREES = {"md", "phd", "mph", "mhpe", "mba", "ms", "msc", "fsiim", "do", "mbbs"}


def api(path, method="GET", fields=None, raw=False):
    """Call the GitHub REST API with the gh CLI. Returns parsed JSON (or text)."""
    cmd = ["gh", "api", "-X", method, path]
    if raw:
        cmd += ["-H", "Accept: application/vnd.github.raw"]
    for key, value in (fields or {}).items():
        cmd += ["-f", f"{key}={value}"]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"{method} {path}: {out.stderr.strip() or out.stdout.strip()}")
    return out.stdout if raw else json.loads(out.stdout or "null")


def pages(path):
    """Get all pages of a list endpoint."""
    items, page = [], 1
    while True:
        sep = "&" if "?" in path else "?"
        batch = api(f"{path}{sep}per_page=100&page={page}")
        items += batch
        if len(batch) < 100:
            return items
        page += 1


def tokens(name):
    """Lowercase name tokens without accents, punctuation, or degrees."""
    text = (name or "").replace("\u0131", "i").replace("\u0130", "I")  # Turkish dotless and dotted i
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    words = re.findall(r"[a-z]+", re.sub(r"['\u2019\u2018`]", "", text))
    return [w for w in words if w not in DEGREES]


def faculty_names(folder):
    """Read the names in the Faculty section of the lab README on main."""
    try:
        readme = api(f"repos/{REPO}/contents/{folder}/README.md?ref=main", raw=True)
    except RuntimeError:
        return []
    names, inside = [], False
    for line in readme.splitlines():
        if line.startswith("## "):
            inside = line.strip().lower() == "## faculty"
            continue
        match = re.match(r"^\s*-\s*\*\*[^*]+\*\*\s*(.+)$", line) if inside else None
        if match:
            name = re.split(r"\s+[—–-]\s+", match.group(1))[0]  # Drop the affiliation
            names.append(name.split(",")[0].strip())  # Drop the degrees after a comma
    return names


def name_matches(candidate, faculty):
    """True if the candidate has the first and the last name of a faculty member."""
    have = set(tokens(candidate))
    for name in faculty:
        want = tokens(name)
        if len(want) >= 2 and len(have) >= 2 and want[0] in have and want[-1] in have:
            return name
    return None


def is_presenter(login, pr_number, folder):
    """Decide if the author is a presenter of the lab in this folder. Returns a reason or None."""
    lab = folder[:2]
    if lab in KNOWN_PRESENTERS.get(login.lower(), set()):
        return "known presenter account"

    # An earlier merged pull request by the same account in the same lab folder
    closed = api(f"repos/{REPO}/pulls?state=closed&base=main&per_page=100")
    earlier = [p for p in closed if p["merged_at"] and p["user"]["login"].lower() == login.lower()
               and p["number"] != pr_number]
    for p in earlier[:10]:
        files = pages(f"repos/{REPO}/pulls/{p['number']}/files")
        if any(f["filename"].startswith(folder + "/") for f in files):
            return f"earlier merged pull request #{p['number']} in this lab"

    # First and last name match with the faculty list of this lab
    faculty = faculty_names(folder)
    candidates = []
    try:
        candidates.append(api(f"users/{login}").get("name") or "")
    except RuntimeError:
        pass
    for commit in pages(f"repos/{REPO}/pulls/{pr_number}/commits"):
        candidates.append(commit["commit"]["author"].get("name") or "")
    for candidate in candidates:
        match = name_matches(candidate, faculty)
        if match:
            return f"name matches {match} in the lab's faculty list"
    return None


def changed_folders(pr_number):
    """Top-level folders (or root file names) that the pull request touches."""
    tops = set()
    for f in pages(f"repos/{REPO}/pulls/{pr_number}/files"):
        for path in (f["filename"], f.get("previous_filename")):
            if path:
                tops.add(path.split("/")[0] if "/" in path else f"(root file) {path}")
    return tops


def mergeable(pr_number):
    """Ask GitHub if the pull request merges without conflicts. Returns (bool or None, head sha)."""
    for _ in range(6):
        pr = api(f"repos/{REPO}/pulls/{pr_number}")
        if pr["mergeable"] is not None or pr["state"] != "open":
            return pr["mergeable"], pr["head"]["sha"]
        time.sleep(4)  # GitHub computes this in the background
    return None, pr["head"]["sha"]


def evaluate(pr):
    """Return (decision, reason). decision is "merge", "skip", or "hold"."""
    number, login = pr["number"], pr["user"]["login"]
    if pr["base"]["ref"] != "main":
        return "skip", "does not target main"
    if pr["draft"]:
        return "skip", "draft"
    if login.lower() == DIRECTOR:
        return "skip", "opened by the lab director, who merges his own pull requests"

    tops = changed_folders(number)
    if len(tops) != 1 or not LAB_FOLDER.match(next(iter(tops))):
        return "hold", "touches files outside one lab folder: " + ", ".join(sorted(tops))
    folder = next(iter(tops))

    approved = any(label["name"] == APPROVAL_LABEL for label in pr["labels"])
    reason = f"label {APPROVAL_LABEL}" if approved else is_presenter(login, number, folder)
    if not reason:
        return "hold", f"author {login} is not recognized as a presenter of {folder}"

    ok, sha = mergeable(number)
    if ok is not True and not ONLY:
        return "hold", "merge conflicts" if ok is False else "GitHub has not finished checking for conflicts"
    return "merge", f"{folder}: {reason}|{sha}"


def merge(pr, sha):
    """Squash-merge with a neutral message, only if the head commit is still the one we checked."""
    title = re.sub(r"#(?=\d)", "", pr["title"]).replace("\n", " ").strip()[:120]
    api(
        f"repos/{REPO}/pulls/{pr['number']}/merge",
        method="PUT",
        fields={
            "merge_method": "squash",
            "sha": sha,
            "commit_title": f"{title} (#{pr['number']})",
            "commit_message": "Merged automatically for the RSNA 2026 Deep Learning Labs.",
        },
    )


def main():
    if ONLY:
        prs = [api(f"repos/{REPO}/pulls/{n}") for n in ONLY]
    else:
        prs = pages(f"repos/{REPO}/pulls?state=open&base=main")
    lines = []
    for pr in prs:
        try:
            decision, reason = evaluate(pr)
            if decision == "merge":
                reason, sha = reason.rsplit("|", 1)
                if DRY_RUN:
                    decision = "would merge"
                else:
                    merge(pr, sha)
                    decision = "merged"
        except RuntimeError as error:
            decision, reason = "error", str(error)[:300]
        lines.append(f"- #{pr['number']} by {pr['user']['login']}: **{decision}** ({reason})")
    report = "\n".join(lines) or "No open pull requests."
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write("### Presenter auto-merge\n" + report + "\n")
    if any("**error**" in line for line in lines):
        sys.exit(1)


if __name__ == "__main__":
    main()
