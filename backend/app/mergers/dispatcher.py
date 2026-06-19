"""
Merge dispatcher — determines the correct merge strategy based on input file types,
runs any required pre-conversion, then calls the appropriate merger.
"""

import logging
from pathlib import Path

from app.mergers.pdf_merger import merge_pdfs
from app.mergers.docx_merger import merge_docx
from app.mergers.text_merger import merge_text

logger = logging.getLogger("docforge.mergers.dispatcher")

# Mapping from file extension to its "type group"
_EXT_GROUP: dict[str, str] = {
    "pdf":  "pdf",
    "docx": "docx",
    "txt":  "txt",
    "md":   "md",
}


def _get_ext(path: Path) -> str:
    return path.suffix.lower().lstrip(".")


def dispatch_merge(
    input_files: list[Path],
    output_dir: Path,
    tmp_pdf_dir: Path,
) -> tuple[Path, str]:
    """
    Choose and run the correct merge strategy for the given input files.

    Strategy selection (in priority order):
    1. All PDF → pdf_merger directly
    2. All DOCX → docx_merger directly
    3. All TXT → text_merger (ext="txt")
    4. All MD → text_merger (ext="md")
    5. Mixed → convert each to PDF via dispatcher, then pdf_merger

    Args:
        input_files: ordered list of input file Paths
        output_dir: where to write the final merged file
        tmp_pdf_dir: scratch dir for intermediate PDFs (mixed merge only)

    Returns:
        Tuple of (output_file_path, output_format_string)

    Raises:
        ValueError: on unsupported combination
        RuntimeError: if any conversion or merge step fails
    """
    if len(input_files) < 2:
        raise ValueError("Merge requires at least 2 files.")

    exts = [_get_ext(f) for f in input_files]
    unique_exts = set(exts)

    logger.info(
        "dispatch_merge: %d files, types=%s", len(input_files), unique_exts
    )

    # ------------------------------------------------------------------ #
    # Homogeneous groups — direct merge
    # ------------------------------------------------------------------ #
    if unique_exts == {"pdf"}:
        out = merge_pdfs(input_files, output_dir)
        return out, "pdf"

    if unique_exts == {"docx"}:
        out = merge_docx(input_files, output_dir)
        return out, "docx"

    if unique_exts == {"txt"}:
        out = merge_text(input_files, output_dir, ext="txt")
        return out, "txt"

    if unique_exts == {"md"}:
        out = merge_text(input_files, output_dir, ext="md")
        return out, "md"

    # ------------------------------------------------------------------ #
    # Mixed types — convert everything to PDF first, then merge
    # ------------------------------------------------------------------ #
    logger.info(
        "dispatch_merge: mixed types %s — converting all to PDF first", unique_exts
    )

    # Import here to avoid circular imports (converters ↔ mergers)
    from app.converters.dispatcher import dispatch as convert_dispatch

    tmp_pdf_dir.mkdir(parents=True, exist_ok=True)
    pdf_files: list[Path] = []

    for i, src in enumerate(input_files):
        ext = _get_ext(src)

        if ext == "pdf":
            # Already PDF — copy to tmp dir to keep ordering clean
            import shutil
            dest = tmp_pdf_dir / f"{i:02d}_{src.name}"
            shutil.copy2(src, dest)
            pdf_files.append(dest)
            logger.info("dispatch_merge: %s already PDF, copied", src.name)
        else:
            # Convert to PDF
            try:
                converted = convert_dispatch(ext, "pdf", src, tmp_pdf_dir)
                # Rename with index prefix to preserve order
                ordered = tmp_pdf_dir / f"{i:02d}_{converted.name}"
                converted.rename(ordered)
                pdf_files.append(ordered)
                logger.info(
                    "dispatch_merge: converted %s → %s", src.name, ordered.name
                )
            except Exception as exc:
                raise RuntimeError(
                    f"Could not convert '{src.name}' to PDF for mixed merge. "
                    f"Reason: {exc}"
                ) from exc

    out = merge_pdfs(pdf_files, output_dir)
    return out, "pdf"
