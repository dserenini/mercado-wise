from PIL import Image, ImageEnhance
from pyzbar.pyzbar import decode, ZBarSymbol
import io
import requests
from bs4 import BeautifulSoup
import re
import logging
import cv2
import os
import numpy as np

logger = logging.getLogger(__name__)

def parse_brl_to_float(val_str: str) -> float:
    """Função segura para converter formato brasileiro e americano para float."""
    clean = re.sub(r'[^\d\.,]', '', val_str)
    if not clean: return 0.0
    if '.' in clean and ',' in clean:
        # Ex: 1.234,56 -> 1234.56
        clean = clean.replace('.', '').replace(',', '.')
    elif ',' in clean:
        # Ex: 62,65 -> 62.65
        clean = clean.replace(',', '.')
    # Se só tiver ponto (ex: 62.65), deixa como está.
    try:
        return float(clean)
    except:
        return 0.0

# Instanciando o modelo WeChat QRCode globalmente se os arquivos existirem
wechat_detector = None
try:
    model_dir = os.path.join(os.path.dirname(__file__), "models")
    wechat_detector = cv2.wechat_qrcode_WeChatQRCode(
        os.path.join(model_dir, "detect.prototxt"),
        os.path.join(model_dir, "detect.caffemodel"),
        os.path.join(model_dir, "sr.prototxt"),
        os.path.join(model_dir, "sr.caffemodel")
    )
except Exception as e:
    logger.warning(f"Aviso: WeChatQRCode não pôde ser ativado ({e})")

def extract_url_from_image(img_bytes: bytes) -> tuple:
    """Extrai a URL de um QR Code contido na imagem e retorna (url, camada)."""
    try:
        base_image = Image.open(io.BytesIO(img_bytes))
        
        # Variantes para testar:
        # 1. Original
        # 2. Escala de cinza
        # 3. Alto contraste
        # 4. Redimensionada (fotos mto grandes podem atrapalhar)
        
        images_to_try = [base_image]
        
        # Cria variante cinza
        gray = base_image.convert('L')
        images_to_try.append(gray)
        
        # Cria variante alto contraste
        enhancer = ImageEnhance.Contrast(gray)
        images_to_try.append(enhancer.enhance(2.0))
        images_to_try.append(enhancer.enhance(3.0))
        
        width, height = base_image.size
        # Cria variante redimensionada se for muito grande
        if max(width, height) > 1000:
            small_img = base_image.copy()
            small_img.thumbnail((1000, 1000), Image.Resampling.LANCZOS)
            images_to_try.append(small_img)
            images_to_try.append(small_img.convert('L'))

        # CAMADA 1: PyZbar (Rápida)
        for img in images_to_try:
            decoded_objects = decode(img, symbols=[ZBarSymbol.QRCODE])
            for obj in decoded_objects:
                if obj.type == 'QRCODE':
                    return obj.data.decode('utf-8'), 1
                    
        # CAMADA 2: OpenCV WeChatQRCode (Resiliente)
        if wechat_detector is not None:
            cv_img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
            res, points = wechat_detector.detectAndDecode(cv_img)
            if res and len(res) > 0 and res[0]:
                return res[0], 2
                
        return None, 0
    except Exception as e:
        logger.error(f"Erro ao tentar ler o formato da imagem: {e}")
        return None, 0

def scrape_sefaz_mg(url: str) -> dict:
    """Acessa a URL da Sefaz MG e retorna os dados relevantes."""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 1. Tentar pegar o Nome do Estabelecimento
        market_name = "Mercado Desconhecido"
        # Na Sefaz MG geralmente fica num div com id u20 ou na classe txtTopo
        topo_div = soup.find('div', id='u20')
        if topo_div:
            market_name = topo_div.get_text(strip=True)
        else:
            txt_topo = soup.find('div', class_='txtTopo')
            if txt_topo:
                market_name = txt_topo.get_text(strip=True)
        
        # 2. Tentar pegar o Valor Total
        total_amount = 0.0
        valor_el = soup.find(string=re.compile("Valor[\\s\\S]*Total", re.I))
        if valor_el:
            parent = valor_el.parent
            if parent:
                td_valor = parent.find_next_sibling('td') or parent.find_next('span', class_='txtMax')
                if td_valor:
                    total_amount = parse_brl_to_float(td_valor.get_text())
        
        # ====== OBTENÇÃO DOS ITENS ======
        items_comprados = []
        
        # TENTATIVA 1: Tabela padronizada pela Sefaz MG (Layout Clássico)
        tabela_produtos = soup.find('table', id='tabResult')
        if tabela_produtos:
            linhas = tabela_produtos.find_all('tr')
            for linha in linhas:
                span_nome = linha.find('span', class_='txtTit')
                if not span_nome:
                    continue
                nome = span_nome.get_text(strip=True)
                
                span_qtd = linha.find('span', class_='RCtd')
                qtd_val = 1.0
                if span_qtd and span_qtd.find('strong'):
                    qtd_val = parse_brl_to_float(span_qtd.find('strong').get_text())
                
                span_un = linha.find('span', class_='RvlUnit')
                preco_un = 0.0
                if span_un and span_un.find('strong'):
                    preco_un = parse_brl_to_float(span_un.find('strong').get_text())
                
                span_total = linha.find('span', class_='valor')
                total_item = 0.0
                if span_total:
                    total_item = parse_brl_to_float(span_total.get_text())
                
                items_comprados.append({
                    "product_name": nome,
                    "quantity": qtd_val,
                    "unit_price": preco_un,
                    "total_price": total_item
                })

        # ====== TENTATIVA 2: Layout Secundário (portalsped) ou Novo Padrão =======
        body_text = soup.body.get_text(separator=' ', strip=True) if soup.body else ""
        
        if market_name == "Mercado Desconhecido":
            m_cnpj = re.search(r'([^\.]+)\s+CNPJ:', body_text)
            if m_cnpj:
                market_name = m_cnpj.group(1).strip()
                market_name = re.sub(r'.*?\(NFC-e\)\s*', '', market_name).strip()
                if not market_name:
                    market_name = "Mercado Desconhecido"
            
        if total_amount == 0.0:
            m_pago = re.search(r'Valor pago R\$?\s*([\d\.,]+)', body_text, re.I)
            if m_pago:
                total_amount = parse_brl_to_float(m_pago.group(1))
                    
        # Items pelo layout de H7 (Layout Secundário)
        if not items_comprados:
            linhas = soup.find_all('tr')
            for linha in linhas:
                tds = linha.find_all('td')
                if not tds or len(tds) < 4: continue
                
                h7_nome = tds[0].find('h7')
                if not h7_nome: continue
                    
                nome = h7_nome.get_text(strip=True)
                
                qtd_val = 1.0
                m_qtd = re.search(r'([\d\.,]+)', tds[1].get_text())
                if m_qtd:
                    qtd_val = parse_brl_to_float(m_qtd.group(1))
                        
                total_item = 0.0
                m_tot = re.search(r'R\$\s*([\d\.,]+)', tds[3].get_text())
                if m_tot:
                    total_item = parse_brl_to_float(m_tot.group(1))
                        
                preco_un = total_item / qtd_val if qtd_val > 0 else total_item
                
                items_comprados.append({
                    "product_name": nome,
                    "quantity": qtd_val,
                    "unit_price": preco_un,
                    "total_price": total_item
                })
        
        # Último caso extremo: Mercado Desconhecido
        if market_name == "Mercado Desconhecido" and "S/A" in body_text:
             market_name = "Supermercado (Sefaz)"

        return {
            "success": True,
            "supermarket_name": market_name,
            "total_amount": total_amount,
            "url": url,
            "items": items_comprados
        }

    except Exception as e:
        logger.error(f"Erro ao extrair HTML Sefaz MG: {e}")
        return {
            "success": False,
            "error": str(e)
        }
