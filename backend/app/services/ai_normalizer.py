"""Normalização de nomes de produto via Gemini (SDK google-genai)."""
import json
import logging

from google import genai
from google.genai import types

from app.config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """
Você é um assistente especialista em normalizar dados de supermercado.
Sua missão é traduzir nomes de cupons fiscais para nomes genéricos, LIMPOS e curtos, focando no NÚCLEO do produto.

Siga as seguintes REGRAS rigorosamente ou você falhará na tarefa:
1. HORTIFRUTI SIMPLIFICADO: Retorne apenas o nome base da fruta/legume/verdura. Remova adjetivos como "Extra", "Premium", "Baby".
2. PADRONIZAÇÃO DE PADARIA: "Pão Francês Assado", "Pao Frances 50g", "Pao Frances Tradicional" -> SEMPRE retorne APENAS "Pão Francês".
3. MARCAS COM SABORES: Em energéticos e marcas com muitos sabores, remova o sabor. "Bebida Energética Monster Ultra 473ml" ou "Energético Monster Fiesta" -> APENAS "Energético Monster".
4. COMMODITIES: Oculte a marca no NOME! Ovos, milho, leite: "Ovos Brancos Iana" -> nome "Ovos Brancos". "Milho Bonare" -> nome "Milho em lata". "Leite Integral Itambé" -> nome "Leite Integral". (A marca ainda vai no campo "brand".)
5. CARNES E CORTES: Remova embalagem e adjetivos de açougue ("Maturada", "Fatiada", "Bandeja"). "Picanha Bovina Maturada", "Picanha Fatiada" -> APENAS "Picanha Bovina".

CAMPOS ADICIONAIS:
- "brand": a MARCA do produto separada do nome genérico ("Monster", "Perdigão", "Itambé"), ou null se for commodity/hortifruti/padaria sem marca aparente. O nome NUNCA deve conter a marca.
- "package_size" e "package_unit": o CONTEÚDO da embalagem extraído do nome. "PAO FOR.IND.500G" -> 500 / "g"; "REFRI COCA 2L" -> 2 / "L"; "SABAO OMO 1,6KG" -> 1.6 / "kg". Se o nome não trouxer tamanho, use null/null. Para itens vendidos a granel/peso (unidade kg), deixe null/null (o peso é a quantidade, não a embalagem).

Exemplos de De-Para (Raw -> name | brand | package_size | package_unit):
- "MELANCIA EXTRA kg" -> "Melancia" | null | null | null
- "MEXERICA PON.EX.kg" -> "Mexerica Ponkan" | null | null | null
- "PAO FR.ASS.kg" -> "Pão Francês" | null | null | null
- "BEB ENERG MONSTER ULTRA 473ML TRAD" -> "Energético Monster" | "Monster" | 473 | "ml"
- "OVOS BCO.IANA" -> "Ovos Brancos" | "Iana" | null | null
- "REFRI COCA COLA 2L" -> "Refrigerante Cola" | "Coca-Cola" | 2 | "L"
- "PIC.BO.MATUR.kg" -> "Picanha Bovina" | null | null | null

Responda ESTRITAMENTE num formato JSON válido:
{
  "resultados": [
     {
       "raw": "O nome original ENVIADO (não altere essa chave)",
       "name": "Nome do produto normalizado seguindo estritamente o De-Para (SEM marca, SEM tamanho)",
       "brand": "Marca do produto ou null",
       "unit": "Unidade ('kg', 'UN', 'L', 'g', 'mL') ou null",
       "package_size": número (ex: 500, 2, 1.6) ou null,
       "package_unit": "Unidade da embalagem ('g', 'kg', 'ml', 'L', 'un') ou null",
       "category": "Açougue, Hortifruti, Mercearia, Limpeza, Padaria, Bebidas, etc."
     }
  ]
}
Não retorne markdown fora do JSON.
"""

_MODEL = "gemini-2.5-flash"


def _coerce_float(value) -> float | None:
    """Converte package_size do Gemini (número ou string 'pt-BR') para float, ou None."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", ".").strip())
    except (ValueError, TypeError):
        return None


class AINormalizerService:
    def __init__(self):
        self.api_key = settings.gemini_api_key
        self.client = genai.Client(api_key=self.api_key) if self.api_key else None

    def is_configured(self) -> bool:
        return self.client is not None

    def normalize_products_batch(self, raw_names: list[str]) -> dict[str, dict]:
        """Mapeia cada nome cru -> {normalized_name, brand, unit, package_size, package_unit, category}."""
        if not self.is_configured():
            logger.warning("Gemini API Key não configurada. Não é possível normalizar produtos por IA.")
            return {}
        if not raw_names:
            return {}

        user_prompt = f"Traduza os seguintes nomes originais tirados de um cupom: {json.dumps(raw_names)}"
        logger.info(f"🧠 Enviando batch de {len(raw_names)} produtos para o Gemini...")

        try:
            response = self.client.models.generate_content(
                model=_MODEL,
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    response_mime_type="application/json",
                ),
            )
            data = json.loads(response.text)

            result_map: dict[str, dict] = {}
            for item in data.get("resultados", []):
                raw_key = item.get("raw")
                if raw_key:
                    result_map[raw_key] = {
                        "normalized_name": item.get("name", raw_key),
                        "brand": item.get("brand") or None,
                        "unit": item.get("unit"),
                        "package_size": _coerce_float(item.get("package_size")),
                        "package_unit": (item.get("package_unit") or None),
                        "category": item.get("category", "Geral"),
                    }
            logger.info(f"✅ Gemini devolveu {len(result_map)} normalizações com sucesso.")
            return result_map
        except Exception as e:
            logger.error(f"❌ Erro ao chamar a API do Gemini: {e}")
            return {}
