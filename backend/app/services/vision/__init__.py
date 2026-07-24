"""Ingestão de nota fiscal por FOTO (OCR de visão).

Pacote nasceu do pivô de ingestão (jul/2026): a Sefaz MG pôs captcha no portal do QR,
e a foto do cupom de papel expõe o EAN-13 real (que o portal esconde). Aqui ficam o
contrato de extração, os validadores determinísticos (o "motor de confiança") e os
adapters de cada motor de OCR avaliados no bake-off.
"""
