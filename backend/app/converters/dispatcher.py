"""Converter dispatcher for source and target format pairs."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from app.converters.docx_converter import docx_to_md, docx_to_pdf, docx_to_txt
from app.converters.image_converter import image_to_pdf
from app.converters.pdf_converter import pdf_to_docx, pdf_to_md, pdf_to_txt
from app.converters.text_converter import md_to_docx, md_to_pdf, md_to_txt, txt_to_docx, txt_to_md, txt_to_pdf

ConverterFunction = Callable[[Path, Path], Path]

CONVERTER_MAP: dict[tuple[str, str], ConverterFunction] = {
    ("pdf", "docx"): pdf_to_docx,
    ("pdf", "txt"): pdf_to_txt,
    ("pdf", "md"): pdf_to_md,
    ("docx", "pdf"): docx_to_pdf,
    ("docx", "txt"): docx_to_txt,
    ("docx", "md"): docx_to_md,
    ("txt", "pdf"): txt_to_pdf,
    ("txt", "md"): txt_to_md,
    ("txt", "docx"): txt_to_docx,
    ("md", "pdf"): md_to_pdf,
    ("md", "docx"): md_to_docx,
    ("md", "txt"): md_to_txt,
    ("png", "pdf"): image_to_pdf,
    ("jpg", "pdf"): image_to_pdf,
    ("jpeg", "pdf"): image_to_pdf,
}

ALLOWED_TARGETS: dict[str, list[str]] = {
    "pdf": ["docx", "txt", "md"],
    "docx": ["pdf", "txt", "md"],
    "txt": ["pdf", "md", "docx"],
    "md": ["pdf", "docx", "txt"],
    "png": ["pdf"],
    "jpg": ["pdf"],
    "jpeg": ["pdf"],
}


def dispatch(source_ext: str, target_ext: str, input_file: Path, output_dir: Path) -> Path:
    """Dispatch a conversion request to the correct converter function."""
    source_key = source_ext.lower().lstrip(".")
    target_key = target_ext.lower().lstrip(".")
    converter = CONVERTER_MAP.get((source_key, target_key))
    if converter is None:
        allowed = ALLOWED_TARGETS.get(source_key, [])
        raise ValueError(
            f"Cannot convert '{source_key}' → '{target_key}'. "
            f"Supported targets for {source_key.upper()}: "
            f"{', '.join(item.upper() for item in allowed) if allowed else 'none'}."
        )
    return converter(input_file, output_dir)
