"""
TXT and MD merge — concatenate text files with filename separators.
"""

import logging
from pathlib import Path

logger = logging.getLogger("docforge.mergers.text")


def merge_text(input_files: list[Path], output_dir: Path, ext: str) -> Path:
    """
    Concatenate text or markdown files in order.

    Each file's content is preceded by an H2 heading with the original filename
    as a separator, making it clear where each source document begins.

    Args:
        input_files: ordered list of TXT or MD file paths (minimum 2)
        output_dir: directory to write the output
        ext: output file extension — "txt" or "md"

    Returns:
        Path to the merged file.

    Raises:
        ValueError: if fewer than 2 files provided
    """
    if len(input_files) < 2:
        raise ValueError("Merge requires at least 2 files.")

    sections: list[str] = []

    for file_path in input_files:
        content = file_path.read_text(encoding="utf-8", errors="replace").strip()
        # Use the original filename stem (strip index prefix added during upload)
        # e.g. "0_notes" → "notes"
        stem = file_path.stem
        if stem and stem[0].isdigit() and "_" in stem:
            stem = stem.split("_", 1)[1]

        header = f"## {stem}"
        sections.append(f"{header}\n\n{content}")
        logger.info("merge_text: read %s (%d chars)", file_path.name, len(content))

    separator = "\n\n---\n\n"
    merged_content = separator.join(sections)

    out = output_dir / f"merged.{ext}"
    out.write_text(merged_content, encoding="utf-8")
    logger.info("merge_text: wrote %s (%d files)", out.name, len(input_files))
    return out
