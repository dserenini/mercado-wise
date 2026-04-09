import httpx
import asyncio

async def test_duplicate_flow():
    base_url = "http://localhost:8000"
    print("Iniciando testes de fluxo de upload...")
    
    # Simular dados de uma compra
    payload_data = {
        "user_id": "e35f0ac5-3e93-4c4b-8efb-81aaa9c6111f",
        "force_save": "false"
    }
    
    # We will upload a dummy file that triggers normal upload flow. 
    # Since we need the scraper to work, we'll hit the easiest endpoint or write a direct DB mocking test if the external service fails.
    # Wait, the `/upload-cupom` expects an actual image with a Sefaz QR code to scrape.
    # So we should use an existing image like 'QRC.jpeg' that we saw in the logs previously.
    # Let's hope it's still in the backend folder or we can check what files are available.
    print("Teste finalizado.")
    
if __name__ == "__main__":
    asyncio.run(test_duplicate_flow())
