import os
import json
import logging
import google.generativeai as genai

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """
Você é um assistente especialista em normalizar dados de supermercado.
Sua missão é traduzir nomes de cupons fiscais para nomes genéricos, LIMPOS e curtos, focando no NÚCLEO do produto.

Siga as seguintes REGRAS rigorosamente ou você falhará na tarefa:
1. HORTIFRUTI SIMPLIFICADO: Retorne apenas o nome base da fruta/legume/verdura. Remova adjetivos como "Extra", "Premium", "Baby".
2. PADRONIZAÇÃO DE PADARIA: "Pão Francês Assado", "Pao Frances 50g", "Pao Frances Tradicional" -> SEMPRE retorne APENAS "Pão Francês".
3. MARCAS COM SABORES: Em energéticos e marcas com muitos sabores, remova o sabor. "Bebida Energética Monster Ultra 473ml" ou "Energético Monster Fiesta" -> APENAS "Energético Monster".
4. COMMODITIES: Oculte a marca! Ovos, milho, leite: "Ovos Brancos Iana" -> "Ovos Brancos". "Milho Bonare" -> "Milho em lata". "Leite Integral Itambé" -> "Leite Integral".
5. CARNES E CORTES: Remova embalagem e adjetivos de açougue ("Maturada", "Fatiada", "Bandeja"). "Picanha Bovina Maturada", "Picanha Fatiada" -> APENAS "Picanha Bovina".

Exemplos de De-Para (Raw -> Normalized):
- "MELANCIA EXTRA kg" -> "Melancia"
- "MEXERICA PON.EX.kg" -> "Mexerica Ponkan"
- "PAO FR.ASS.kg" -> "Pão Francês"
- "BEB ENERG MONSTER ULTRA 473ML TRAD TRAD" -> "Energético Monster"
- "OVOS BCO.IANA" -> "Ovos Brancos"
- "PIC.BO.MATUR.kg" -> "Picanha Bovina"

Responda ESTRITAMENTE num formato JSON válido:
{
  "resultados": [
     {
       "raw": "O nome original ENVIADO (não altere essa chave)",
       "name": "Nome do produto normalizado seguindo estritamente o De-Para",
       "unit": "Unidade ('kg', 'UN', 'L', 'g', 'mL') ou null",
       "category": "Açougue, Hortifruti, Mercearia, Limpeza, Padaria, Bebidas, etc."
     }
  ]
}
Não retorne markdown fora do JSON.
"""

class AINormalizerService:
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        if self.api_key:
            genai.configure(api_key=self.api_key)
            self.model = genai.GenerativeModel(
                model_name='gemini-2.5-flash',
                system_instruction=SYSTEM_PROMPT,
                generation_config={"response_mime_type": "application/json"}
            )
        else:
            self.model = None

    def is_configured(self):
        return self.model is not None

    def normalize_products_batch(self, raw_names: list[str]) -> dict[str, dict]:
        """
        Recebe uma lista de nomes não formatados (ex: 'PIC.BO.MATUR.kg') e pede para o Gemini
        normalizar os nomes gramaticalmente, extraindo a unidade original de medida e a categoria.
        Retorna um dicionário mapeando o nome raw para o resultado estruturado.
        """
        if not self.is_configured():
            logger.warning("Gemini API Key não configurada. Não é possível normalizar produtos por IA.")
            return {}

        if not raw_names:
            return {}

        user_prompt = f"Traduza os seguintes nomes originais tirados de um cupom: {json.dumps(raw_names)}"

        logger.info(f"🧠 Enviando batch de {len(raw_names)} produtos para o Gemini...")

        try:
            # Requisita a geração ao modelo usando o JSON schema forçado pelo generation_config local/global
            response = self.model.generate_content(user_prompt)
            data = json.loads(response.text)
            
            result_map = {}
            for item in data.get("resultados", []):
                raw_key = item.get("raw")
                if raw_key:
                    result_map[raw_key] = {
                        "normalized_name": item.get("name", raw_key),
                        "unit": item.get("unit"),
                        "category": item.get("category", "Geral")
                    }
            logger.info(f"✅ Gemini devolveu {len(result_map)} normalizações com sucesso.")
            return result_map
            
        except Exception as e:
            logger.error(f"❌ Erro ao chamar a API do Gemini: {e}")
            return {}
