import asyncio
from database import db
from services.ai_normalizer import AINormalizerService
from main import process_scraped_items
import json

ai = AINormalizerService()

fake_items = [
    {"product_name": "MELANCIA EXTRA kg", "quantity": 1, "unit_price": 5.0},
    {"product_name": "BEB ENERG MONSTER ULTRA 473ML TRAD TRAD", "quantity": 2, "unit_price": 9.49},
]

print("--- RUN 1: Cache Miss (Vai chamar Gemini) ---")
res1 = process_scraped_items(db, fake_items, ai)
print("Resultado 1:")
print(json.dumps(res1, indent=2))

print("\n--- RUN 2: Cache Hit (Vai usar o DB) ---")
res2 = process_scraped_items(db, fake_items, ai)
print("Resultado 2:")
print(json.dumps(res2, indent=2))
