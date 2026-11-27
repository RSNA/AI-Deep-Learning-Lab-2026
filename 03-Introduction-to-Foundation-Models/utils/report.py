import re


def extract_findings(text):
    """
    Keep only the findings part of a generated report.
    Removes the FINDINGS title and the IMPRESSION section.

    Args:
        text: Generated report.

    Returns:
        str: The findings text.
    """
    m = re.search(r"\bfindings\b[\s*#]*:", text, flags=re.IGNORECASE)  # The title needs a colon
    if m:
        text = text[m.end() :]
    text = re.split(r"[\s*#]*\bimpression\b[\s*#]*:", text, flags=re.IGNORECASE)[0]
    return re.sub(r"^\s*(\*\*\s*)?", "", text).rstrip(" \n*#")
