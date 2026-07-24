"""Camada de validação determinística (A2) — o "motor de confiança".

Independe do motor de OCR. Usa a redundância aritmética do próprio cupom para detectar
leituras erradas sem precisar de gabarito: dígito verificador do GTIN, `qtd×preço=total`
por linha, `Σ=total` da nota, e os DVs de CNPJ e chave de acesso. É o que transforma
"OCR frágil" em "OCR confiável": erros na maioria dos casos se denunciam sozinhos.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.services.vision.schema import Item, ReceiptExtraction

# Tolerância padrão de preço (centavos). Arredondamento de qtd×preço permite folga.
_MONEY_TOL = 0.02
# Unidades vendidas a peso: preço unitário é R$/medida e qtd é fracionária → tolerância maior.
_WEIGHABLE = {"kg", "g", "l", "ml"}


# --------------------------------------------------------------------------- #
# Dígitos verificadores
# --------------------------------------------------------------------------- #
def gtin_check_digit_ok(code: str | None) -> bool:
    """Valida o dígito verificador de um GTIN-8/12/13/14 (EAN/UPC).

    Peso 3,1,3,1... a partir do dígito imediatamente à esquerda do verificador.
    """
    if not code or not code.isdigit() or len(code) not in (8, 12, 13, 14):
        return False
    *payload, check = (int(c) for c in code)
    total = 0
    for i, d in enumerate(reversed(payload)):
        total += d * (3 if i % 2 == 0 else 1)
    return (10 - total % 10) % 10 == check


def is_weighable_code(code: str | None) -> bool:
    """Código curto (PLU/balança) — pesável/hortifruti sem EAN de fabricante. Não é erro."""
    return bool(code) and code.isdigit() and len(code) < 8


def cnpj_is_valid(cnpj: str | None) -> bool:
    if not cnpj:
        return False
    d = [int(c) for c in cnpj if c.isdigit()]
    if len(d) != 14 or len(set(d)) == 1:
        return False

    def _dv(nums: list[int]) -> int:
        weights = list(range(len(nums) + 1, 1, -1))
        # pesos do CNPJ ciclam 2..9; ajusta quando passa de 9
        weights = [(w - 2) % 8 + 2 for w in weights]
        s = sum(n * w for n, w in zip(nums, weights))
        r = s % 11
        return 0 if r < 2 else 11 - r

    return _dv(d[:12]) == d[12] and _dv(d[:13]) == d[13]


def access_key_is_valid(key: str | None) -> bool:
    """Chave de acesso NFC-e: 44 dígitos, último é DV por módulo 11 (pesos 2..9)."""
    if not key or not key.isdigit() or len(key) != 44:
        return False
    body, check = key[:43], int(key[43])
    s, w = 0, 2
    for c in reversed(body):
        s += int(c) * w
        w = 2 if w == 9 else w + 1
    r = s % 11
    dv = 0 if r in (0, 1) else 11 - r
    return dv == check


# --------------------------------------------------------------------------- #
# Aritmética linha/nota
# --------------------------------------------------------------------------- #
def line_arithmetic_ok(item: Item, tol: float = _MONEY_TOL) -> bool | None:
    """`qtd × preco_unit ≈ preco_total`. Retorna None quando faltam dados p/ julgar."""
    q, pu, pt = item.qtd, item.preco_unit, item.preco_total
    if q is None or pu is None or pt is None:
        return None
    # Pesáveis acumulam mais erro de arredondamento (qtd com 3 casas) → folga proporcional.
    unit = (item.unidade or "").lower()
    local_tol = max(tol, 0.01 * pt) if unit in _WEIGHABLE else tol
    return abs(q * pu - pt) <= local_tol + 1e-9


# --------------------------------------------------------------------------- #
# Relatório
# --------------------------------------------------------------------------- #
OK = "ok"
LOW = "baixa_confianca"
FAIL = "falhou"


@dataclass
class ItemVerdict:
    index: int
    descricao: str | None
    ean_status: str          # ok | falhou | ausente (pesável) | ausente_esperado
    line_status: str         # ok | falhou | indeterminado
    label: str               # OK | LOW | FAIL
    problems: list[str] = field(default_factory=list)


@dataclass
class ReceiptVerdict:
    items: list[ItemVerdict]
    sum_items: float
    declared_total: float | None
    total_ok: bool | None
    total_diff: float | None
    cnpj_ok: bool | None
    access_key_ok: bool | None
    cnpj_matches_key: bool | None
    n_ok: int
    n_low: int
    n_fail: int

    @property
    def traffic_light(self) -> str:
        """verde = salvar direto; amarelo = revisar; vermelho = refazer foto."""
        if self.n_fail == 0 and (self.total_ok is True) and self.n_low == 0:
            return "verde"
        if self.n_fail == 0 and (self.total_ok in (True, None)) and self.n_low <= 2:
            return "amarelo"
        # muitas falhas ou total muito fora
        if self.total_diff is not None and self.declared_total \
                and abs(self.total_diff) > max(0.5, 0.05 * self.declared_total):
            return "vermelho"
        return "vermelho" if self.n_fail > 3 else "amarelo"


def validate_item(item: Item, index: int) -> ItemVerdict:
    problems: list[str] = []

    # EAN
    if item.ean:
        if gtin_check_digit_ok(item.ean):
            ean_status = "ok"
        else:
            ean_status = "falhou"
            problems.append(f"EAN {item.ean} reprova no dígito verificador")
    elif is_weighable_code(item.cod_interno):
        ean_status = "ausente"  # pesável legítimo
    else:
        ean_status = "ausente_esperado"
        problems.append("sem EAN e sem código de balança")

    # Aritmética
    arr = line_arithmetic_ok(item)
    if arr is True:
        line_status = "ok"
    elif arr is False:
        line_status = "falhou"
        problems.append(
            f"qtd×preço≠total ({item.qtd}×{item.preco_unit}≠{item.preco_total})"
        )
    else:
        line_status = "indeterminado"
        problems.append("dados insuficientes p/ checar aritmética")

    # Rótulo agregado
    if ean_status == "falhou" or line_status == "falhou":
        label = FAIL
    elif ean_status == "ausente_esperado" or line_status == "indeterminado":
        label = LOW
    else:
        label = OK

    return ItemVerdict(index, item.descricao, ean_status, line_status, label, problems)


def validate(extraction: ReceiptExtraction, tol: float = _MONEY_TOL) -> ReceiptVerdict:
    verdicts = [validate_item(it, i) for i, it in enumerate(extraction.itens)]

    sum_items = round(sum(it.preco_total or 0.0 for it in extraction.itens), 2)
    declared = extraction.emitente.total
    total_diff = round(sum_items - declared, 2) if declared is not None else None
    total_ok = (abs(total_diff) <= max(tol, 0.02 * (declared or 0))) if declared is not None else None

    cnpj = extraction.emitente.cnpj
    key = extraction.emitente.chave_acesso
    cnpj_ok = cnpj_is_valid(cnpj) if cnpj else None
    key_ok = access_key_is_valid(key) if key else None
    cnpj_matches_key = None
    if cnpj and key and len(key) == 44:
        cnpj_matches_key = key[6:20] == cnpj  # posições 7..20 da chave = CNPJ

    return ReceiptVerdict(
        items=verdicts,
        sum_items=sum_items,
        declared_total=declared,
        total_ok=total_ok,
        total_diff=total_diff,
        cnpj_ok=cnpj_ok,
        access_key_ok=key_ok,
        cnpj_matches_key=cnpj_matches_key,
        n_ok=sum(1 for v in verdicts if v.label == OK),
        n_low=sum(1 for v in verdicts if v.label == LOW),
        n_fail=sum(1 for v in verdicts if v.label == FAIL),
    )
