"""Image to PDF converter."""

from __future__ import annotations

import logging
from pathlib import Path

from PIL import Image

from app.converters.utils import output_path

logger = logging.getLogger("docforge.converters.image")


def image_to_pdf(input_file: Path, output_dir: Path) -> Path:
    """Convert a PNG or JPG image to a single-page PDF."""
    out = output_path(output_dir, input_file.stem, "pdf")
    image = Image.open(str(input_file))
    if image.mode in ("RGBA", "P", "LA"):
        image = image.convert("RGB")
    image.save(str(out), "PDF", resolution=150)
    logger.info("image→pdf done: %s → %s", input_file.name, out.name)
    return out
