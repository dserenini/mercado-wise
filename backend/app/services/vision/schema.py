"""Contrato de extração único (A1) — todos os motores de OCR devolvem isto.

Mantém-se propositalmente próximo do que a ingestão da Sefaz já produz (nome, cprod,
unidade, quantidade, preço) para reusar `process_scraped_items`/persistência sem atrito,
acrescentando o que a foto traz de novo: o `ean` e sinais de qualidade/confiança.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class Emitente:
    nome: str | None = None
    cnpj: str | None = None
    endereco: str | None = None
    chave_acesso: str | None = None
    data: str | None = None            # ISO 'YYYY-MM-DD' quando possível
    total: float | None = None
    forma_pagamento: str | None = None


@dataclass
class Item:
    ean: str | None = None             # código de barras (GTIN-8/12/13/14); None em pesáveis
    cod_interno: str | None = None     # código curto de balança/PLU quando não há EAN
    descricao: str | None = None       # nome cru como impresso (vira raw_name na ingestão)
    qtd: float | None = None
    unidade: str | None = None         # UN, KG, LT, PT, BJ...
    preco_unit: float | None = None
    preco_total: float | None = None
    confianca: float | None = None     # 0..1 auto-relatada pelo motor (quando disponível)
    # Normalização feita NA MESMA chamada de visão (evita um 2º call ao Gemini):
    nome_normalizado: str | None = None  # nome genérico/limpo, SEM marca (ex.: "Creme de Leite")
    marca: str | None = None             # marca separada (ex.: "Camponesa"); None em hortifruti
    package_size: float | None = None    # tamanho da embalagem (ex.: 200)
    package_unit: str | None = None      # unidade da embalagem (g, ml, kg, L, un)
    categoria: str | None = None         # Açougue, Hortifruti, Mercearia, Limpeza, Bebidas...


@dataclass
class Meta:
    eh_cupom: bool = True
    orientacao: str | None = None                 # 'ok' | 'girada' | 'invertida'
    flags_qualidade: list[str] = field(default_factory=list)  # 'borrada','escura','glare',...
    linhas_ilegiveis: list[str] = field(default_factory=list)


@dataclass
class ReceiptExtraction:
    """Resultado normalizado de um motor de OCR sobre UMA imagem."""
    emitente: Emitente = field(default_factory=Emitente)
    itens: list[Item] = field(default_factory=list)
    meta: Meta = field(default_factory=Meta)
    engine: str | None = None          # 'gemini' | 'claude' | 'paddle' | ...
    latency_s: float | None = None
    raw_response: Any = None           # payload bruto do motor, p/ depuração

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_payload(payload: dict, engine: str | None = None) -> "ReceiptExtraction":
        """Constrói a partir de um dict solto (tolerante a chaves faltando/extras)."""
        emi = payload.get("emitente") or {}
        meta = payload.get("meta") or {}
        itens_raw = payload.get("itens") or payload.get("items") or []

        def _num(v):
            if v is None or v == "":
                return None
            if isinstance(v, (int, float)):
                return float(v)
            try:
                return float(str(v).replace(".", "").replace(",", ".")) if str(v).count(",") == 1 \
                    else float(str(v).replace(",", ""))
            except (ValueError, TypeError):
                return None

        def _digits(v):
            if v is None:
                return None
            d = "".join(ch for ch in str(v) if ch.isdigit())
            return d or None

        itens = []
        for it in itens_raw:
            itens.append(Item(
                ean=_digits(it.get("ean") or it.get("gtin") or it.get("codigo_barras")),
                cod_interno=(str(it.get("cod_interno")).strip() if it.get("cod_interno") else None),
                descricao=(it.get("descricao") or it.get("nome") or it.get("product_name")),
                qtd=_num(it.get("qtd") if it.get("qtd") is not None else it.get("quantity")),
                unidade=(it.get("unidade") or it.get("unit")),
                preco_unit=_num(it.get("preco_unit") if it.get("preco_unit") is not None
                                else it.get("unit_price")),
                preco_total=_num(it.get("preco_total") if it.get("preco_total") is not None
                                 else it.get("total_price")),
                confianca=_num(it.get("confianca")),
                nome_normalizado=(it.get("nome_normalizado") or None),
                marca=(it.get("marca") or None),
                package_size=_num(it.get("package_size") if it.get("package_size") is not None
                                  else it.get("tam_valor")),
                package_unit=(it.get("package_unit") or it.get("tam_unidade") or None),
                categoria=(it.get("categoria") or None),
            ))

        return ReceiptExtraction(
            emitente=Emitente(
                nome=emi.get("nome"),
                cnpj=_digits(emi.get("cnpj")),
                endereco=emi.get("endereco"),
                chave_acesso=_digits(emi.get("chave_acesso") or emi.get("access_key")),
                data=emi.get("data"),
                total=_num(emi.get("total")),
                forma_pagamento=emi.get("forma_pagamento"),
            ),
            itens=itens,
            meta=Meta(
                eh_cupom=bool(meta.get("eh_cupom", True)),
                orientacao=meta.get("orientacao"),
                flags_qualidade=list(meta.get("flags_qualidade") or []),
                linhas_ilegiveis=list(meta.get("linhas_ilegiveis") or []),
            ),
            engine=engine,
            raw_response=payload,
        )
