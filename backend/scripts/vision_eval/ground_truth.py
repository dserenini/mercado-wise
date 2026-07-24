"""Gabarito (ground truth) da nota de teste para o bake-off de OCR.

Duas fontes, ambas confiáveis:
- NUMÉRICO/DESCRIÇÃO/cProd/total: parseados da webarchive pelo parser determinístico
  da Sefaz (`_parse_sefaz_html`) — 32/32 itens conferidos, total R$ 366,40.
- EAN: transcrição manual da foto, aceita no gabarito SÓ quando passa no dígito
  verificador GTIN. 20 EANs confirmados; 2 incertos e 10 pesáveis ficam como None
  (EAN não exigido) — usados só para não penalizar/creditar indevidamente.

A webarchive é de outra loja (JM E MATTEI) com a MESMA cesta e os MESMOS preços da
foto (BH) — coincidência útil: dá gabarito numérico determinístico para a foto.
"""
from __future__ import annotations

import plistlib
from pathlib import Path

from app.services.scrapers.mg_sefaz import _parse_sefaz_html

_FIX = Path(__file__).parent / "fixtures"
_WEBARCHIVE = _FIX / "nota_bh.webarchive"

# EAN por posição, ALINHADO à ordem de impressão (idêntica na webarchive e na foto).
# None = pesável (código de balança, sem EAN) OU leitura incerta (excluído do match).
# Todos os valores não-None abaixo passam no dígito verificador GTIN-13.
_EAN_BY_INDEX: list[str | None] = [
    "7894900360042",  # 0  AG TON SCHW ZERO 350
    "7896602903374",  # 1  TAPIOCA HID PACH 500
    "7896098906880",  # 2  KIT LIMP YPE M U C/4
    "7891080008931",  # 3  FAR TR BH ESP 1KG        (recuperado por OCR, confere no DV)
    "7898215152002",  # 4  LTE COND PIRAC 395G
    "7898949747390",  # 5  MILH VDE NECT V 700G     (recuperado por OCR, confere no DV)
    None,             # 6  CARNE BOVINA ANCHO M     (pesável)
    "7898312041278",  # 7  FILE P FGO AVIV 1KG
    None,             # 8  LIMAO                    (pesável)
    "7898959897498",  # 9  TOALHA UMED BH
    None,             # 10 MANGA TOMY               (pesável)
    None,             # 11 MAMAO FORMOSO            (pesável)
    None,             # 12 PERA                     (pesável)
    "7896259411628",  # 13 CR LTE CAMPON 200G
    "7898174850353",  # 14 AZ VDE SABOROSAS 500
    "7908529700162",  # 15 EXT TOM SALSAR 330G
    "7898598211518",  # 16 MILH VDE M MAIS 170G
    "8410660101153",  # 17 AZEITE LA ESP 500ML
    "7896036001684",  # 18 MOL TOM POM TRAD 200
    None,             # 19 CENOURA VERMELHA         (pesável)
    "7898305010335",  # 20 BAT PALH B APET 300G
    "7896051168829",  # 21 IOG ITAMBE NAT 340G
    None,             # 22 BATATA DOCE BRANCA       (pesável)
    None,             # 23 PAO FRANC F PROP         (pesável)
    "7896071021548",  # 24 BISC MABEL ROSQ 500G
    None,             # 25 ALFACE CRES              (pesável)
    "7891010245085",  # 26 ABS HIG INT OB
    "7891150062153",  # 27 LIMP CR CIF 450ML
    "7892840822637",  # 28 SALG E CHI TORC 60G
    None,             # 29 BANANA PRATA             (pesável)
    "7892840817077",  # 30 SALG E CHI TORC 100G (a)
    "7892840819859",  # 31 SALG E CHI TORC 100G (b)
]


def _load_webarchive_html(path: Path) -> str:
    data = plistlib.load(path.open("rb"))["WebMainResource"]["WebResourceData"]
    return data.decode("utf-8")


def load_ground_truth() -> dict:
    """Retorna o gabarito: cabeçalho + 32 itens (numérico determinístico + EAN verificado)."""
    html = _load_webarchive_html(_WEBARCHIVE)
    parsed = _parse_sefaz_html(html, "https://portalsped.fazenda.mg.gov.br/", None)
    items = parsed.get("items", [])
    if len(items) != len(_EAN_BY_INDEX):
        raise AssertionError(
            f"gabarito desalinhado: webarchive tem {len(items)} itens, "
            f"EAN_BY_INDEX tem {len(_EAN_BY_INDEX)}"
        )

    gold_items = []
    for i, it in enumerate(items):
        gold_items.append({
            "descricao": it["product_name"],
            "cprod": it.get("cprod"),
            "ean": _EAN_BY_INDEX[i],
            "qtd": round(float(it.get("quantity") or 0), 3),
            "unidade": it.get("unit"),
            "preco_unit": round(float(it.get("unit_price") or 0), 2),
            "preco_total": round(float(it.get("total_price") or 0), 2),
        })

    return {
        "header": {
            "cnpj": parsed.get("cnpj"),
            "access_key": parsed.get("access_key"),
            "data": parsed.get("purchase_date"),
            "total": round(float(parsed.get("total_amount") or 0), 2),
        },
        "items": gold_items,
        "n_items": len(gold_items),
        "n_ean_known": sum(1 for e in _EAN_BY_INDEX if e),
    }


if __name__ == "__main__":
    import json
    gt = load_ground_truth()
    print(json.dumps(gt["header"], ensure_ascii=False, indent=2))
    print(f"itens: {gt['n_items']} | EANs conhecidos: {gt['n_ean_known']}")
    for it in gt["items"]:
        print(f"  {it['ean'] or '(sem EAN)':>14}  {it['descricao']:<24} "
              f"{it['qtd']}x{it['preco_unit']} = {it['preco_total']}")
