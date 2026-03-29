import os
from supabase import create_client, Client
from datetime import datetime

# --- CONFIGURAÇÃO ---
# Copie os valores do seu arquivo .env ou do painel do Supabase
url: str = "https://hwxngdlzzriedwcnqlok.supabase.co"
key: str = "sb_secret_FkGWex6IG38aal4TSWIYfA__HTOSvZL"

# Conecta ao Banco
print(f"🔌 Conectando ao Supabase em: {url}...")
try:
    supabase: Client = create_client(url, key)
except Exception as e:
    print(f"❌ Erro fatal na conexão inicial: {e}")
    exit()

def teste_conexao_simples():
    # --- TESTE 1: LEITURA (Profiles) ---
    print("\n1️⃣ Testando LEITURA (Tabela profiles)...")
    try:
        # Tenta pegar apenas 1 registro para ver se a porta está aberta
        response = supabase.table("profiles").select("*").limit(1).execute()
        
        if response.data:
            print(f"   ✅ Sucesso! Leu o perfil do usuário: {response.data[0].get('id')}")
            # Guardamos o ID para usar no próximo teste se precisar, ou usamos o primeiro que vier
        else:
            print("   ⚠️ Conexão OK, mas tabela 'profiles' está vazia. (Isso não é um erro de conexão)")
            
    except Exception as e:
        print(f"   ❌ Falha na leitura: {e}")
        return # Para por aqui se não consegue nem ler

    # --- TESTE 2: ESCRITA (Products) ---
    # A tabela products geralmente é simples: só precisa de um nome.
    print("\n2️⃣ Testando ESCRITA (Tabela products)...")
    
    # Vamos tentar adivinhar o nome da coluna baseado nos erros anteriores
    # O erro anterior mostrou que o banco espera 'name' ou 'product_name'.
    payload = {"name": "Produto de Teste Python 🐍"}
    
    try:
        # Tenta inserir
        res = supabase.table("products").insert(payload).execute()
        print(f"   ✅ Sucesso! Produto criado. ID: {res.data[0].get('id')}")
        
    except Exception as e:
        # Se der erro, verificamos se é por causa do nome da coluna
        erro_msg = str(e)
        if "column" in erro_msg and "name" in erro_msg:
             print("   ⚠️ Tentando nome de coluna alternativo ('product_name')...")
             try:
                 payload_alt = {"product_name": "Produto de Teste Python 🐍"}
                 res = supabase.table("products").insert(payload_alt).execute()
                 print(f"   ✅ Sucesso na segunda tentativa! Produto criado.")
             except Exception as e2:
                 print(f"   ❌ Falha na escrita (Tentativa 2): {e2}")
        else:
            print(f"   ❌ Falha na escrita: {e}")

if __name__ == "__main__":
    teste_conexao_simples()