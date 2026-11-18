import os
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

MONTGOMERY_URL = (
    "https://data.lhncbc.nlm.nih.gov/public/Tuberculosis-Chest-X-ray-Datasets/"
    "Montgomery-County-CXR-Set/MontgomerySet"
)
# The folders that RadHarmony reads
MONTGOMERY_FOLDERS = ["CXR_png", "ManualMask/leftMask", "ManualMask/rightMask", "ClinicalReadings"]
SITE_DOWN = (
    "The NLM site may be down for maintenance. "
    f"Open {MONTGOMERY_URL}/index.html to check. Try again later."
)


def _download_file(url, path, tries=3):
    """
    Download one file. Try again if the download fails.
    Write to a temporary file first, so a stopped download leaves no broken file.
    """
    tmp = path + ".part"
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as response, open(tmp, "wb") as f:
                f.write(response.read())
            break
        except (urllib.error.URLError, OSError):
            if attempt == tries - 1:
                raise
            time.sleep(5)
    # A web page in place of the file (for example, when the site is down) starts with "<"
    with open(tmp, "rb") as f:
        if f.read(1) == b"<":
            os.remove(tmp)
            raise RuntimeError(f"NLM sent a web page, not the file {url}. {SITE_DOWN}")
    os.replace(tmp, path)


def download_montgomery(dest="data/Montgomery-CXR"):
    """
    Download the Montgomery County chest X-ray set from NLM: 138 images with lung masks.

    Makes the folder layout that RadHarmony expects: dest/MontgomerySet/CXR_png,
    ManualMask (leftMask, rightMask), and ClinicalReadings. Downloads each file separately,
    8 at the same time. Skips the files that are already there.

    Args:
        dest: Output folder.

    Returns:
        str: The image folder (dest/MontgomerySet/CXR_png).
    """
    root = os.path.join(dest, "MontgomerySet")
    image_dir = os.path.join(root, "CXR_png")
    done = os.path.join(dest, ".montgomery.done")  # Written only after all files are there
    if not os.path.exists(done):
        jobs = []
        for folder in MONTGOMERY_FOLDERS:
            # Read the file names from the web page of the folder
            try:
                with urllib.request.urlopen(f"{MONTGOMERY_URL}/{folder}/index.html", timeout=60) as page:
                    html = page.read().decode()
            except urllib.error.URLError as error:
                raise RuntimeError(f"Cannot open the {folder} folder. {SITE_DOWN}") from error
            names = sorted(set(re.findall(r"href='(MCUCXR_\w+\.(?:png|txt))'", html)))
            if not names:
                raise RuntimeError(f"No files in the {folder} folder. {SITE_DOWN}")
            os.makedirs(os.path.join(root, folder), exist_ok=True)
            for name in names:
                path = os.path.join(root, folder, name)
                if not os.path.exists(path):
                    jobs.append((f"{MONTGOMERY_URL}/{folder}/{name}", path))
        if jobs:
            print(f"⬇️  Downloading {len(jobs)} Montgomery files ...")
        with ThreadPoolExecutor(max_workers=8) as pool:
            # list() waits for all downloads and raises the first error
            list(pool.map(lambda job: _download_file(*job), jobs))
        open(done, "w").close()
    print(f"✅ Montgomery data ready: {image_dir}")
    return image_dir
