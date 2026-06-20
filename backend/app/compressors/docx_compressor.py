"""
DOCX compression by recompressing embedded images.

DOCX files are ZIP archives. The largest contributors to file size are
images stored under word/media/. We unzip, recompress each image using
Pillow, and repack as a new DOCX.

This is pure Python — no system dependencies required.
"""

import io
import logging
import zipfile
from pathlib import Path

from PIL import Image

logger = logging.getLogger("docforge.compressors.docx")

# Per quality level: (jpeg_quality, max_dimension_px)
# max_dimension=None means keep original dimensions
_QUALITY_SETTINGS: dict[str, tuple[int, int | None]] = {
    "low":    (40, 1280),
    "medium": (65, 1920),
    "high":   (85, None),
}

# Image extensions we will recompress
_COMPRESSIBLE = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif"}


def _recompress_image(data: bytes, jpeg_quality: int, max_dim: int | None) -> bytes:
    """
    Recompress image bytes using Pillow.

    Converts to JPEG (RGB) at the given quality. Optionally resizes
    if the image exceeds max_dim in either dimension.

    Returns recompressed JPEG bytes.
    """
    img = Image.open(io.BytesIO(data))

    # Convert to RGB (JPEG doesn't support alpha)
    if img.mode in ("RGBA", "P", "LA"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # Resize if exceeds max dimension
    if max_dim is not None:
        w, h = img.size
        if w > max_dim or h > max_dim:
            ratio = min(max_dim / w, max_dim / h)
            new_size = (int(w * ratio), int(h * ratio))
            img = img.resize(new_size, Image.LANCZOS)
            logger.debug("recompress_image: resized %dx%d → %dx%d", w, h, *new_size)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
    return buf.getvalue()


def compress_docx(
    input_file: Path,
    output_dir: Path,
    quality: str,
) -> Path:
    """
    Compress a DOCX file by recompressing its embedded images.

    Args:
        input_file: path to the source DOCX
        output_dir: directory to write the compressed output
        quality: one of "low", "medium", "high"

    Returns:
        Path to the compressed DOCX.

    Raises:
        ValueError: if quality is invalid
        RuntimeError: if the file cannot be processed
    """
    if quality not in _QUALITY_SETTINGS:
        raise ValueError(
            f"Invalid quality '{quality}'. Choose from: low, medium, high."
        )

    jpeg_quality, max_dim = _QUALITY_SETTINGS[quality]
    out = output_dir / f"{input_file.stem}_compressed.docx"

    original_size = input_file.stat().st_size
    images_recompressed = 0
    bytes_saved = 0

    try:
        with zipfile.ZipFile(input_file, "r") as zin:
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    data = zin.read(item.filename)
                    ext = Path(item.filename).suffix.lower()

                    # Recompress images in word/media/
                    if item.filename.startswith("word/media/") and ext in _COMPRESSIBLE:
                        original_len = len(data)
                        try:
                            compressed = _recompress_image(data, jpeg_quality, max_dim)
                            # Only use compressed version if it's actually smaller
                            if len(compressed) < original_len:
                                # Rename .png/.bmp etc to .jpeg since we converted
                                new_name = (
                                    item.filename.rsplit(".", 1)[0] + ".jpeg"
                                    if not ext in (".jpg", ".jpeg")
                                    else item.filename
                                )
                                saved = original_len - len(compressed)
                                bytes_saved += saved
                                images_recompressed += 1
                                logger.debug(
                                    "compress_docx: %s %d→%d bytes (saved %d)",
                                    item.filename, original_len, len(compressed), saved,
                                )
                                zout.writestr(new_name, compressed)
                                continue
                        except Exception as img_err:
                            logger.warning(
                                "compress_docx: could not recompress %s: %s — keeping original",
                                item.filename, img_err,
                            )

                    # All other files (XML, rels, fonts, etc.) — copy as-is
                    zout.writestr(item, data)

    except zipfile.BadZipFile as exc:
        raise RuntimeError(
            f"'{input_file.name}' does not appear to be a valid DOCX file."
        ) from exc

    output_size = out.stat().st_size
    reduction_pct = (1 - output_size / original_size) * 100 if original_size > 0 else 0

    logger.info(
        "compress_docx: %s → %s | images=%d | saved=%d bytes (%.1f%%)",
        input_file.name, out.name, images_recompressed, bytes_saved, reduction_pct,
    )

    # If no images found or output is larger, return a copy of the original
    if output_size >= original_size:
        logger.warning(
            "compress_docx: output not smaller than input "
            "(no compressible images found or already optimized)"
        )

    return out
