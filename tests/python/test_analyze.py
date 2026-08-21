from pathlib import Path

from slopfactor.analyze import analyze_pdf_text, analyze_source_tree, appendix_page_count


def test_counts_source_environments_equations_and_bibliography(tmp_path: Path) -> None:
    (tmp_path / "main.tex").write_text(
        r"""
        \documentclass{article}
        \newtheorem{thm}{Theorem}
        \newtheorem{lem}[thm]{Lemma}
        \begin{document}
        \input{section}
        \begin{thm}Statement.\end{thm}
        \begin{lem}Statement.\end{lem}
        \begin{equation}x=y\end{equation}
        \[a=b\]
        \begin{thebibliography}{1}
        \bibitem{one} One.
        \bibitem{two} Two.
        \end{thebibliography}
        \end{document}
        """,
        "utf8",
    )
    (tmp_path / "section.tex").write_text(r"\begin{proposition}P.\end{proposition}", "utf8")

    counts, notes = analyze_source_tree(tmp_path)

    assert counts["theorems"] == 1
    assert counts["lemmas"] == 1
    assert counts["propositions"] == 1
    assert counts["displayed_equations"] == 2
    assert counts["bibliography_entries"] == 2
    assert "main.tex" in notes[0]


def test_pdf_text_fallback_counts_headings_and_appendix() -> None:
    pages = [
        "Theorem 1. A statement.\nLemma 2. A statement.\n          x = y",
        "References\n[1] First item\n[2] Second item",
        "Appendix A\nDefinition 3. A definition.",
    ]

    counts = analyze_pdf_text(pages)

    assert counts["theorems"] == 1
    assert counts["lemmas"] == 1
    assert counts["bibliography_entries"] == 2
    assert appendix_page_count(pages) == 1
