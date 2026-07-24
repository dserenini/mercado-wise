"""Runner do bake-off (A5): roda cada motor × cada variante de degradação, pontua contra
o gabarito e gera `out/report.md`.

Uso:
    python -m scripts.vision_eval.run_eval --engines gemini
    python -m scripts.vision_eval.run_eval --engines gemini,claude,paddle --variants 00_original,05_blur_gauss
"""
from __future__ import annotations

import argparse
import logging
import re
import time
from pathlib import Path

from app.services.vision.schema import ReceiptExtraction
from app.services.vision.validators import validate, gtin_check_digit_ok
from scripts.vision_eval.degrade import build_variants
from scripts.vision_eval.ground_truth import load_ground_truth

logging.disable(logging.WARNING)
_FIX = Path(__file__).parent / "fixtures" / "nota_papel.jpeg"
_OUT = Path(__file__).parent / "out"

_TOKEN = re.compile(r"[A-Z0-9]+")


def _tokens(s: str | None) -> set[str]:
    return set(_TOKEN.findall((s or "").upper()))


def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if (a or b) else 0.0


def _match(gold_items: list[dict], pred: ReceiptExtraction) -> dict[int, int]:
    """Alinha índice de item do gabarito -> índice do predito (guloso, EAN forte, depois nome)."""
    preds = pred.itens
    pairs = []
    for gi, g in enumerate(gold_items):
        gt = _tokens(g["descricao"])
        for pi, p in enumerate(preds):
            score = _jaccard(gt, _tokens(p.descricao))
            if g["ean"] and p.ean and g["ean"] == p.ean:
                score += 1.0
            pairs.append((score, gi, pi))
    pairs.sort(reverse=True)
    used_g, used_p, mapping = set(), set(), {}
    for score, gi, pi in pairs:
        if gi in used_g or pi in used_p or score < 0.34:
            continue
        used_g.add(gi); used_p.add(pi); mapping[gi] = pi
    return mapping


def score(gold: dict, pred: ReceiptExtraction) -> dict:
    gold_items = gold["items"]
    mapping = _match(gold_items, pred)

    ean_known = [g for g in gold_items if g["ean"]]
    ean_hit = 0
    for gi, g in enumerate(gold_items):
        if not g["ean"] or gi not in mapping:
            continue
        if pred.itens[mapping[gi]].ean == g["ean"]:
            ean_hit += 1

    pred_eans = [p.ean for p in pred.itens if p.ean]
    ean_valid = sum(1 for e in pred_eans if gtin_check_digit_ok(e))

    price_hit = qty_hit = comparable = 0
    for gi, pi in mapping.items():
        g, p = gold_items[gi], pred.itens[pi]
        comparable += 1
        if p.preco_total is not None and abs(p.preco_total - g["preco_total"]) <= 0.011:
            price_hit += 1
        if p.qtd is not None and abs(p.qtd - g["qtd"]) <= 0.0011:
            qty_hit += 1

    v = validate(pred)
    pred_total = pred.emitente.total if pred.emitente.total is not None else v.sum_items
    total_err = abs(pred_total - gold["header"]["total"])

    return {
        "items_found": len(pred.itens),
        "matched": len(mapping),
        "ean_exact": f"{ean_hit}/{len(ean_known)}",
        "ean_exact_pct": round(100 * ean_hit / len(ean_known), 1),
        "ean_valid": f"{ean_valid}/{len(pred_eans)}" if pred_eans else "0/0",
        "price_acc": round(100 * price_hit / comparable, 1) if comparable else 0.0,
        "qty_acc": round(100 * qty_hit / comparable, 1) if comparable else 0.0,
        "total_err": round(total_err, 2),
        "val_fail": v.n_fail,
        "val_low": v.n_low,
        "semaforo": v.traffic_light,
        "latency_s": pred.latency_s,
    }


def _load_engine(name: str):
    if name == "gemini":
        from app.services.vision.extractor_gemini import GeminiExtractor
        return GeminiExtractor()
    raise ValueError(f"motor desconhecido: {name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engines", default="gemini")
    ap.add_argument("--variants", default="", help="subconjunto separado por vírgula; vazio = todas")
    args = ap.parse_args()

    gold = load_ground_truth()
    all_variants = build_variants(str(_FIX))
    if args.variants:
        wanted = set(args.variants.split(","))
        all_variants = {k: v for k, v in all_variants.items() if k in wanted}

    engines = [e.strip() for e in args.engines.split(",") if e.strip()]
    _OUT.mkdir(parents=True, exist_ok=True)

    rows = []
    for eng_name in engines:
        try:
            engine = _load_engine(eng_name)
        except Exception as e:
            print(f"⚠️  motor '{eng_name}' indisponível: {e}")
            continue
        for vname, data in sorted(all_variants.items()):
            t0 = time.perf_counter()
            try:
                pred = engine.extract(data)
                if pred.latency_s is None:
                    pred.latency_s = round(time.perf_counter() - t0, 2)
                s = score(gold, pred)
                s["engine"], s["variant"] = engine.name, vname
                rows.append(s)
                print(f"[{engine.name}] {vname:18} itens={s['items_found']:2} "
                      f"EAN={s['ean_exact']:>6} preço={s['price_acc']:5}% "
                      f"totErr={s['total_err']:5} {s['semaforo']:8} {s['latency_s']}s")
            except Exception as e:
                print(f"[{eng_name}] {vname:18} ERRO: {e}")

    _write_report(rows, gold)


def _write_report(rows: list[dict], gold: dict):
    lines = ["# Bake-off OCR — relatório", "",
             f"Gabarito: {gold['n_items']} itens, {gold['n_ean_known']} EANs conhecidos, "
             f"total R$ {gold['header']['total']}.", "",
             "| Motor | Variante | Itens | EAN exato | EAN válido | Preço% | Qtd% | Erro Total | "
             "val_fail | Semáforo | Latência |",
             "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(
            f"| {r['engine']} | {r['variant']} | {r['items_found']} | {r['ean_exact']} "
            f"| {r['ean_valid']} | {r['price_acc']} | {r['qty_acc']} | {r['total_err']} "
            f"| {r['val_fail']} | {r['semaforo']} | {r['latency_s']}s |")
    (_OUT / "report.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"\n[report] salvo em {_OUT / 'report.md'}")


if __name__ == "__main__":
    main()
