"""Interface comum dos extratores de visão (A1).

Cada motor (Gemini, Claude, PaddleOCR, ...) é um adapter que recebe os bytes de UMA
imagem e devolve um `ReceiptExtraction`. Assim o harness de eval e o endpoint de
produção trocam de motor sem tocar no resto do pipeline.
"""
from __future__ import annotations

from typing import Protocol

from app.services.vision.schema import ReceiptExtraction


class VisionExtractor(Protocol):
    name: str

    def extract(self, img_bytes: bytes, mime_type: str = "image/jpeg") -> ReceiptExtraction:
        ...


# Prompt compartilhado pelos motores baseados em LLM (Gemini, Claude). Motores de OCR
# puro (Paddle/Tesseract) não usam isto — têm seu próprio parser geométrico.
EXTRACTION_PROMPT = """\
Você transcreve CUPONS FISCAIS brasileiros (NFC-e / "Documento Auxiliar da Nota Fiscal \
de Consumidor Eletrônica") a partir de uma foto. Devolva SOMENTE os dados que estão \
impressos, sem inventar nada.

REGRAS OBRIGATÓRIAS:
1. Transcreva VERBATIM. Se um caractere está ilegível (borrão, sombra, dobra, objeto \
   cobrindo), use null naquele campo — NUNCA chute dígitos.
2. A imagem pode estar girada ou de cabeça para baixo: leia mesmo assim.
3. Para cada item da tabela (colunas típicas: Cod, Descr, Qtd, Unid, Preço, Total):
   - "ean": o código de barras da coluna Cod QUANDO tiver 8 a 14 dígitos (produto \
     embalado). Se o código for curto (< 8 dígitos, típico de hortifruti/açougue \
     pesado na balança), deixe "ean" null e ponha o número em "cod_interno".
   - "descricao": APENAS o nome cru como impresso na coluna Descr (abreviado, ex.: \
     "AG TON SCHW ZERO 350"). NÃO inclua quantidade, unidade nem preço. NÃO tente \
     "traduzir" ou expandir — transcreva exatamente o que está impresso (a normalização \
     é feita depois, pelo código de barras).
   - "qtd": número (use ponto decimal). "unidade": UN/KG/LT/PT/BJ/TP/VD/FR/SH...
   - "preco_unit": preço unitário. "preco_total": total da linha.
4. Cabeçalho: nome do emitente, cnpj (só dígitos), endereço, chave de acesso (44 \
   dígitos, se visível), data (converta para AAAA-MM-DD), total da nota, forma de pagamento.
5. Em "meta": eh_cupom (false se a foto não for um cupom), orientacao \
   ("ok"/"girada"/"invertida"), flags_qualidade (lista: "borrada","escura","glare",\
   "recortada","dobra"), linhas_ilegiveis (descrições que você não conseguiu ler).

Responda ESTRITAMENTE neste JSON (sem markdown, sem texto fora do JSON):
{
  "emitente": {"nome": str|null, "cnpj": str|null, "endereco": str|null,
               "chave_acesso": str|null, "data": str|null, "total": number|null,
               "forma_pagamento": str|null},
  "itens": [{"ean": str|null, "cod_interno": str|null, "descricao": str|null,
             "qtd": number|null, "unidade": str|null, "preco_unit": number|null,
             "preco_total": number|null}],
  "meta": {"eh_cupom": bool, "orientacao": str|null, "flags_qualidade": [str],
           "linhas_ilegiveis": [str]}
}
"""
