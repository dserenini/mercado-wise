"""Leitura de QR Code em fotos de cupom (agnóstico de UF).

Pipeline robusto para fotos de celular, agora LAZY: as variantes de imagem são
geradas sob demanda e o pipeline curto-circuita no primeiro QR decodificado,
evitando materializar dezenas de imagens quando a primeira já resolve.
"""
import io
import os
import logging
from collections.abc import Iterator

import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageOps, ImageFilter
from pyzbar.pyzbar import decode, ZBarSymbol

logger = logging.getLogger(__name__)

# Modelos WeChatQRCode carregados uma única vez, se presentes
_wechat_detector = None
try:
    _model_dir = os.path.join(os.path.dirname(__file__), "models")
    _wechat_detector = cv2.wechat_qrcode_WeChatQRCode(
        os.path.join(_model_dir, "detect.prototxt"),
        os.path.join(_model_dir, "detect.caffemodel"),
        os.path.join(_model_dir, "sr.prototxt"),
        os.path.join(_model_dir, "sr.caffemodel"),
    )
except Exception as e:  # pragma: no cover
    logger.warning(f"Aviso: WeChatQRCode não pôde ser ativado ({e})")


def _pil_variants(base_image: Image.Image) -> Iterator[tuple[str, Image.Image]]:
    """Gera variantes Pillow sob demanda (o consumidor para no primeiro sucesso)."""
    yield "original", base_image

    gray = base_image.convert("L")
    yield "gray", gray

    enhancer = ImageEnhance.Contrast(gray)
    yield "contrast_2x", enhancer.enhance(2.0)
    yield "contrast_3x", enhancer.enhance(3.0)
    yield "sharp", gray.filter(ImageFilter.SHARPEN)

    width, height = base_image.size
    for size in (3000, 2000, 1500, 1000, 800, 500):
        if max(width, height) > size:
            resized = base_image.copy()
            resized.thumbnail((size, size), Image.Resampling.LANCZOS)
            yield f"resize_{size}", resized
            resized_gray = resized.convert("L")
            yield f"resize_{size}_gray", resized_gray
            yield f"resize_{size}_contrast", ImageEnhance.Contrast(resized_gray).enhance(2.0)


def _cv_variants(base_image: Image.Image) -> Iterator[tuple[str, "np.ndarray"]]:
    """Gera variantes OpenCV sob demanda para o WeChatQRCode."""
    corrected = io.BytesIO()
    base_image.save(corrected, format="PNG")
    cv_base = cv2.imdecode(np.frombuffer(corrected.getvalue(), np.uint8), cv2.IMREAD_COLOR)
    if cv_base is None:
        return

    yield "cv_original", cv_base

    cv_gray = cv2.cvtColor(cv_base, cv2.COLOR_BGR2GRAY)
    yield "cv_gray", cv2.cvtColor(cv_gray, cv2.COLOR_GRAY2BGR)

    _, otsu = cv2.threshold(cv_gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    yield "cv_otsu", cv2.cvtColor(otsu, cv2.COLOR_GRAY2BGR)

    adaptive = cv2.adaptiveThreshold(
        cv_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 51, 10
    )
    yield "cv_adaptive", cv2.cvtColor(adaptive, cv2.COLOR_GRAY2BGR)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    yield "cv_clahe", cv2.cvtColor(clahe.apply(cv_gray), cv2.COLOR_GRAY2BGR)

    kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
    yield "cv_sharp", cv2.filter2D(cv_base, -1, kernel)

    h, w = cv_base.shape[:2]
    for size in (1500, 1000, 800, 500):
        if max(h, w) > size:
            scale = size / max(h, w)
            yield f"cv_resize_{size}", cv2.resize(cv_base, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)


def _try_pyzbar(img: Image.Image) -> str | None:
    for obj in decode(img, symbols=[ZBarSymbol.QRCODE]):
        if obj.type == "QRCODE":
            return obj.data.decode("utf-8")
    return None


def _try_wechat(cv_img) -> str | None:
    if _wechat_detector is None:
        return None
    try:
        res, _ = _wechat_detector.detectAndDecode(cv_img)
        if res and len(res) > 0 and res[0]:
            return res[0]
    except Exception as e:  # pragma: no cover
        logger.debug(f"WeChatQRCode falhou: {e}")
    return None


def extract_url_from_image(img_bytes: bytes) -> tuple[str | None, int]:
    """Retorna (url, camada). camada: 1=PyZbar, 2=WeChatQRCode, 0=falha."""
    try:
        base_image = Image.open(io.BytesIO(img_bytes))
        try:
            base_image = ImageOps.exif_transpose(base_image)
        except Exception as e:
            logger.warning(f"⚠️ Falha ao aplicar EXIF transpose: {e}")

        logger.info(f"📏 Dimensões: {base_image.size}")

        # CAMADA 1: PyZbar (rápida) — lazy
        for name, img in _pil_variants(base_image):
            url = _try_pyzbar(img)
            if url:
                logger.info(f"✅ QR lido por PyZbar (variante: {name})")
                return url, 1

        # CAMADA 2: WeChatQRCode (resiliente) — lazy
        for name, cv_img in _cv_variants(base_image):
            url = _try_wechat(cv_img)
            if url:
                logger.info(f"✅ QR lido por WeChatQRCode (variante: {name})")
                return url, 2

        # CAMADA 3: rotações de 90° (último recurso)
        logger.info("🔄 Tentando rotações de 90°...")
        for angle in (90, 180, 270):
            rotated = base_image.rotate(angle, expand=True)
            url = _try_pyzbar(rotated.convert("L"))
            if url:
                logger.info(f"✅ QR lido após rotação de {angle}°")
                return url, 1
            if _wechat_detector is not None:
                rot = io.BytesIO()
                rotated.save(rot, format="PNG")
                rot_cv = cv2.imdecode(np.frombuffer(rot.getvalue(), np.uint8), cv2.IMREAD_COLOR)
                if rot_cv is not None:
                    url = _try_wechat(rot_cv)
                    if url:
                        logger.info(f"✅ QR lido por WeChatQRCode após rotação de {angle}°")
                        return url, 2

        logger.warning("❌ Nenhum QR Code detectado após todas as tentativas.")
        return None, 0
    except Exception as e:
        logger.error(f"Erro ao tentar ler o formato da imagem: {e}")
        return None, 0
