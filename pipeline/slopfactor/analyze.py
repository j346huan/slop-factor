"""Structural analysis using arXiv source with documented PDF-text fallbacks."""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .archive import extract_source
from .score import WEIGHTS

THEOREM_KINDS = {
    "theorems": {"theorem", "thm"},
    "lemmas": {"lemma", "lem"},
    "propositions": {"proposition", "prop"},
    "corollaries": {"corollary", "cor"},
    "definitions": {"definition", "defn", "def"},
}
DISPLAY_ENVIRONMENTS = {
    "equation",
    "equation*",
    "align",
    "align*",
    "alignat",
    "alignat*",
    "gather",
    "gather*",
    "multline",
    "multline*",
    "flalign",
    "flalign*",
    "displaymath",
    "eqnarray",
    "eqnarray*",
}
NEW_THEOREM = re.compile(
    r"\\newtheorem\*?\s*\{([^}]+)\}(?:\s*\[[^]]+\])?\s*\{([^}]+)\}",
    re.IGNORECASE,
)
INPUT = re.compile(r"\\(?:input|include)\s*\{([^}]+)\}")


@dataclass(frozen=True)
class AnalysisResult:
    counts: dict[str, int]
    methods: dict[str, str]
    notes: list[str]


def strip_tex_comments(text: str) -> str:
    lines: list[str] = []
    for line in text.splitlines():
        kept: list[str] = []
        for index, character in enumerate(line):
            if character == "%":
                slashes = 0
                cursor = index - 1
                while cursor >= 0 and line[cursor] == "\\":
                    slashes += 1
                    cursor -= 1
                if slashes % 2 == 0:
                    break
            kept.append(character)
        lines.append("".join(kept))
    return "\n".join(lines)


def _find_main_tex(root: Path) -> Path:
    candidates = sorted(root.rglob("*.tex"), key=lambda path: (len(path.parts), str(path)))
    if not candidates:
        raise ValueError("Source archive contains no TeX files")
    document_roots = [
        path for path in candidates if "\\documentclass" in path.read_text("utf8", errors="ignore")
    ]
    return document_roots[0] if document_roots else candidates[0]


def _expand_tex(path: Path, root: Path, visited: set[Path]) -> str:
    resolved = path.resolve()
    if resolved in visited or (
        resolved != root.resolve() and root.resolve() not in resolved.parents
    ):
        return ""
    visited.add(resolved)
    text = path.read_text("utf8", errors="ignore")

    def include(match: re.Match[str]) -> str:
        relative = Path(match.group(1))
        if not relative.suffix:
            relative = relative.with_suffix(".tex")
        target = (path.parent / relative).resolve()
        if not target.is_file():
            return match.group(0)
        return _expand_tex(target, root, visited)

    return INPUT.sub(include, text)


def _theorem_environments(text: str) -> dict[str, set[str]]:
    environments = {key: set(value) for key, value in THEOREM_KINDS.items()}
    for environment, printed_name in NEW_THEOREM.findall(text):
        label = re.sub(r"[^a-z]", "", printed_name.lower())
        for key, known_names in environments.items():
            singular = key.removesuffix("s")
            if singular in label or label in known_names:
                known_names.add(environment)
                break
    return environments


def analyze_source_tree(root: Path) -> tuple[dict[str, int], list[str]]:
    """Analyze the expanded primary TeX document and its bibliography files."""
    main = _find_main_tex(root)
    text = strip_tex_comments(_expand_tex(main, root, set()))
    environments = _theorem_environments(text)
    counts: dict[str, int] = {}
    for key, names in environments.items():
        pattern = re.compile(r"\\begin\s*\{(" + "|".join(map(re.escape, names)) + r")\}")
        counts[key] = len(pattern.findall(text))

    equation_pattern = re.compile(
        r"\\begin\s*\{(" + "|".join(map(re.escape, DISPLAY_ENVIRONMENTS)) + r")\}"
    )
    displayed = len(equation_pattern.findall(text))
    displayed += len(re.findall(r"\\\[(?:.|\n)*?\\\]", text))
    displayed += len(re.findall(r"(?<!\\)\$\$(?:.|\n)*?(?<!\\)\$\$", text))
    counts["displayed_equations"] = displayed

    embedded_bibitems = len(re.findall(r"\\bibitem(?:\[[^]]*\])?\s*\{", text))
    bbl_counts = []
    for bbl in root.rglob("*.bbl"):
        bbl_counts.append(
            len(
                re.findall(
                    r"\\bibitem(?:\[[^]]*\])?\s*\{",
                    bbl.read_text("utf8", errors="ignore"),
                )
            )
        )
    bibitems = max(bbl_counts, default=0) or embedded_bibitems
    if bibitems:
        counts["bibliography_entries"] = bibitems
    else:
        entries = 0
        for bibliography in root.rglob("*.bib"):
            entries += len(
                re.findall(
                    r"(?m)^\s*@(?!comment\b|preamble\b|string\b)[a-zA-Z]+\s*\{",
                    bibliography.read_text("utf8", errors="ignore"),
                    re.IGNORECASE,
                )
            )
        counts["bibliography_entries"] = entries

    notes = [f"Source counts use the expanded primary TeX file {main.relative_to(root)}."]
    return counts, notes


def extract_pdf_text(pdf: Path) -> list[str]:
    executable = shutil.which("pdftotext")
    if not executable:
        raise RuntimeError("pdftotext is required for PDF-text analysis")
    completed = subprocess.run(
        [executable, "-layout", str(pdf), "-"],
        check=True,
        capture_output=True,
        timeout=180,
    )
    text = completed.stdout.decode("utf8", errors="replace")
    pages = text.split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    return pages


def pdf_page_count(pdf: Path, pages: list[str]) -> tuple[int, str]:
    executable = shutil.which("pdfinfo")
    if executable:
        completed = subprocess.run(
            [executable, str(pdf)], check=True, capture_output=True, text=True, timeout=60
        )
        match = re.search(r"(?m)^Pages:\s+(\d+)\s*$", completed.stdout)
        if match:
            return int(match.group(1)), "pdf"
    if pages:
        return len(pages), "estimated"
    raise ValueError("Could not determine PDF page count")


def analyze_pdf_text(pages: list[str]) -> dict[str, int]:
    text = "\n".join(pages)
    counts: dict[str, int] = {}
    headings = {
        "theorems": "Theorem",
        "lemmas": "Lemma",
        "propositions": "Proposition",
        "corollaries": "Corollary",
        "definitions": "Definition",
    }
    for key, label in headings.items():
        counts[key] = len(re.findall(rf"(?m)^\s*{label}\s+(?:[A-Z]?\d+|[IVX]+)(?:[.:(\s]|$)", text))

    displayed = 0
    in_block = False
    for line in text.splitlines():
        stripped = line.strip()
        math_like = (
            1 <= len(stripped) <= 180
            and len(re.findall(r"[=≤≥∑∫→←↔]|\b(?:lim|sup|inf|max|min)\b", stripped)) >= 1
            and not stripped.endswith((".", ",", ";"))
        )
        if math_like and not in_block:
            displayed += 1
        in_block = math_like
    counts["displayed_equations"] = displayed

    references = re.split(r"(?im)^\s*(?:references|bibliography)\s*$", text, maxsplit=1)
    reference_text = references[1] if len(references) == 2 else ""
    numbered = re.findall(r"(?m)^\s*(?:\[\d+\]|\d+\.\s+)\s*\S", reference_text)
    counts["bibliography_entries"] = len(numbered)
    return counts


def appendix_page_count(pages: list[str]) -> int:
    for index, page in enumerate(pages):
        if re.search(r"(?im)^\s*(?:appendix|appendices)(?:\s+[A-Z0-9])?(?:[.:\s].*)?$", page):
            return len(pages) - index
    return 0


def analyze_document(pdf: Path, source_archive: Path | None = None) -> AnalysisResult:
    """Return complete formula counts and per-field provenance."""
    pages = extract_pdf_text(pdf)
    total_pages, page_method = pdf_page_count(pdf, pages)
    pdf_counts = analyze_pdf_text(pages)
    counts: dict[str, int] = {"pages": total_pages}
    methods: dict[str, str] = {"pages": page_method}
    notes: list[str] = []

    source_counts: dict[str, int] | None = None
    if source_archive is not None and source_archive.is_file():
        try:
            with tempfile.TemporaryDirectory(prefix="slop-factor-source-") as temporary:
                root = Path(temporary)
                extract_source(source_archive, root)
                source_counts, source_notes = analyze_source_tree(root)
                notes.extend(source_notes)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            notes.append(f"Source parsing failed; PDF-text fallbacks were used: {error}")
    else:
        notes.append("arXiv source was unavailable; PDF-text fallbacks were used.")

    for key in (
        "theorems",
        "lemmas",
        "propositions",
        "corollaries",
        "definitions",
        "displayed_equations",
        "bibliography_entries",
    ):
        if source_counts is not None:
            counts[key] = source_counts[key]
            methods[key] = "source"
        else:
            counts[key] = pdf_counts[key]
            methods[key] = "pdf_fallback"

    counts["appendix_pages"] = appendix_page_count(pages)
    methods["appendix_pages"] = "estimated"
    notes.append(
        "Appendix pages include the first PDF page with an explicit Appendix heading "
        "through the final page."
    )

    if counts.keys() != WEIGHTS.keys():
        raise AssertionError("Analysis did not produce every formula count")
    return AnalysisResult(counts=counts, methods=methods, notes=notes)
