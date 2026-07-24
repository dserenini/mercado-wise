"""Gerador de degradação (A4): a partir de 1 foto boa, sintetiza os edge-cases que uma
foto de usuário costuma ter — para medir robustez sem depender de novas fotos.

Usa só PIL/cv2/numpy (já instalados). Cada variante devolve bytes JPEG prontos p/ o motor.
"""
from __future__ import annotations

import io

import cv2
import numpy as np
from PIL import Image, ImageOps, ImageFilter, ImageEnhance

# Lado maior padrão das variantes: realista p/ upload de celular já reduzido.
_BASE_MAX = 1600


def _to_jpeg(im: Image.Image, quality: int = 90) -> bytes:
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def _fit(im: Image.Image, max_side: int = _BASE_MAX) -> Image.Image:
    im = im.copy()
    im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return im


def _pil_to_cv(im: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.array(im.convert("RGB")), cv2.COLOR_RGB2BGR)


def _cv_to_pil(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))


def _glare(im: Image.Image) -> Image.Image:
    """Mancha de brilho/reflexo cobrindo parte da nota."""
    arr = _pil_to_cv(im).astype(np.float32)
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    cy, cx = h * 0.4, w * 0.55
    r = min(h, w) * 0.35
    mask = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * r ** 2))
    arr += (255 - arr) * mask[..., None] * 0.9
    return _cv_to_pil(np.clip(arr, 0, 255).astype(np.uint8))


def _occlusion(im: Image.Image) -> Image.Image:
    """Objeto opaco (dedo/sombra) cobrindo algumas linhas do meio."""
    arr = _pil_to_cv(im).copy()
    h, w = arr.shape[:2]
    y0, y1 = int(h * 0.45), int(h * 0.62)
    x0, x1 = int(w * 0.05), int(w * 0.75)
    cv2.rectangle(arr, (x0, y0), (x1, y1), (60, 60, 65), -1)
    return _cv_to_pil(arr)


def _perspective(im: Image.Image) -> Image.Image:
    """Warp de perspectiva (foto de cima/de lado)."""
    arr = _pil_to_cv(im)
    h, w = arr.shape[:2]
    src = np.float32([[0, 0], [w, 0], [0, h], [w, h]])
    dx, dy = w * 0.12, h * 0.06
    dst = np.float32([[dx, dy], [w - dx * 0.4, 0], [0, h], [w, h - dy]])
    M = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(arr, M, (w, h), borderValue=(245, 245, 245))
    return _cv_to_pil(warped)


def _motion_blur(im: Image.Image, k: int = 15) -> Image.Image:
    arr = _pil_to_cv(im)
    kernel = np.zeros((k, k), np.float32)
    kernel[k // 2, :] = 1.0 / k
    return _cv_to_pil(cv2.filter2D(arr, -1, kernel))


def build_variants(src_path: str) -> dict[str, bytes]:
    """Gera todas as variantes de degradação a partir da foto-fonte."""
    base = ImageOps.exif_transpose(Image.open(src_path))
    base = _fit(base)

    variants: dict[str, Image.Image] = {
        "00_original": base,
        "01_rot90": base.rotate(90, expand=True),
        "02_rot180": base.rotate(180, expand=True),
        "03_rot270": base.rotate(270, expand=True),
        "04_rot_leve7": base.rotate(7, expand=True, fillcolor=(245, 245, 245)),
        "05_blur_gauss": base.filter(ImageFilter.GaussianBlur(2.2)),
        "06_blur_motion": _motion_blur(base),
        "07_escura": ImageEnhance.Brightness(base).enhance(0.45),
        "08_estourada": ImageEnhance.Brightness(base).enhance(1.7),
        "09_baixo_contraste": ImageEnhance.Contrast(base).enhance(0.45),
        "10_glare": _glare(base),
        "11_oclusao": _occlusion(base),
        "12_perspectiva": _perspective(base),
        "13_baixa_res": _fit(base, 700),
    }

    out: dict[str, bytes] = {}
    for name, im in variants.items():
        # jpeg_low leva compressão agressiva; demais, qualidade normal.
        out[name] = _to_jpeg(im, quality=90)
    out["14_jpeg_baixo"] = _to_jpeg(base, quality=18)
    return out


if __name__ == "__main__":
    from pathlib import Path
    src = Path(__file__).parent / "fixtures" / "nota_papel.jpeg"
    outdir = Path(__file__).parent / "out" / "variants"
    outdir.mkdir(parents=True, exist_ok=True)
    for name, data in build_variants(str(src)).items():
        (outdir / f"{name}.jpg").write_bytes(data)
        print(f"{name:20} {len(data)//1024:4} KB")
