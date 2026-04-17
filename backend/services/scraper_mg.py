from PIL import Image, ImageEnhance, ImageOps, ImageFilter
from pyzbar.pyzbar import decode, ZBarSymbol
import io
import requests
from bs4 import BeautifulSoup
import re
import logging
import cv2
import os
import numpy as np
from datetime import datetime

logger = logging.getLogger(__name__)

# Aliases carregados do banco (populados em _load_db_aliases, chamado no startup da API)
# Lista de dicts: [{"alias": str, "display_name": str}, ...] ordenada por priority
_DB_ALIASES: list[dict] = []

def reload_db_aliases():
    """Carrega (ou recarrega) os aliases de supermercado do banco.
    Chamado uma vez no startup da API. Pode ser re-chamado para atualizar sem reiniciar.
    """
    global _DB_ALIASES
    try:
        from database import load_supermarket_aliases
        _DB_ALIASES = load_supermarket_aliases()
    except Exception as e:
        logger.error(f"Erro ao carregar aliases do banco: {e}")
        _DB_ALIASES = []


def extract_cnpj_base_from_url(url: str) -> str | None:
    """Extrai os primeiros 8 dígitos do CNPJ a partir da URL do QR Code NFC-e.

    A chave NF-e de 44 dígitos (parâmetro 'p') tem o formato:
      cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1)

    O CNPJ começa na posição 6. Os 8 primeiros dígitos (posições 6-13)
    identificam o grupo empresarial, independente da filial.
    """
    try:
        m = re.search(r'[?&]p=([^|&]+)', url)
        if not m:
            return None
        chave = re.sub(r'[^0-9]', '', m.group(1))  # apenas dígitos
        if len(chave) < 20:
            return None
        cnpj_base = chave[6:14]
        logger.info(f"🪪 CNPJ base extraído da URL: {cnpj_base}")
        return cnpj_base
    except Exception as e:
        logger.warning(f"Não foi possível extrair CNPJ da URL: {e}")
        return None

# ===========================================================================
# DICIONÁRIO DE MERCADOS CONHECIDOS
# Chave: substring que aparece no nome bruto (UPPER)
# Valor: nome limpo para exibição
# ===========================================================================
KNOWN_MARKETS = {
    "ATACADAO": "Atacadão",
    "ATACADÃO": "Atacadão",
    "ASSAI": "Assaí",
    "ASSAÍ": "Assaí",
    "CARREFOUR": "Carrefour",
    "EXTRA": "Extra",
    "PÃO DE AÇÚCAR": "Pão de Açúcar",
    "PAO DE ACUCAR": "Pão de Açúcar",
    "WALMART": "Walmart",
    "MUFFATO": "Super Muffato",
    "BH SUPERMERCADOS": "Supermercados BH",
    "SUPERMERCADOS BH": "Supermercados BH",
    "PREZUNIC": "Prezunic",
    "PAGUE MENOS": "Pague Menos",
    "BAHIA": "Casas Bahia",
    "MAKRO": "Makro",
    "SAM'S CLUB": "Sam's Club",
    "SAMS CLUB": "Sam's Club",
    "HORTIFRUTI": "Hortifruti",
    "NATURAL DA TERRA": "Natural da Terra",
    "REDE SMART": "Rede Smart",
    "SMART": "Smart",
    "COMPER": "Comper",
    "ANGELONI": "Angeloni",
    "ZAFFARI": "Zaffari",
    "BISTEK": "Bistek",
    "ENXUTO": "Enxuto",
    "MATEUS": "Mateus",
    "NORDESTÃO": "Nordestão",
    "NORDESTAO": "Nordestão",
    "SUPERNOSSO": "SuperNosso",
    "SUPER NOSSO": "SuperNosso",
    "EPA": "EPA",
    "NAGUMO": "Nagumo",
    "VERDEMAR": "Verdemar",
    "MINEIRÃO": "Mineirão",
    "MINEIRAO": "Mineirão",
    "ECOMIX": "Ecomix",
}

_NOISE_TOKENS = {
    "LTDA", "SA", "S/A", "S.A", "EIRELI", "EPP", "ME", "CIA",
    "COMERCIAL", "COMERCIO", "COML", "COM",
    "DE", "DO", "DA", "DOS", "DAS", "E",
    "ALIMENTOS", "DE ALIMENTOS", "PRODUTOS",
    "DISTRIBUIDORA", "DISTRIBUIDOR",
    "SUPERMERCADOS", "SUPERMERCADO",
    "HIPERMERCADOS", "HIPERMERCADO",
    "ATACADO", "ATACADISTA",
    "MERCADO", "MERCEARIA",
    "INDUSTRIA", "IND",
    "LTDA.", "S.A.", "CIA.",
}



def clean_market_name(raw: str, cnpj_base: str | None = None) -> str:
    """Limpa e normaliza o nome do supermercado extraído da Sefaz.

    Ordem de prioridade:
      1. CNPJ base (8 dígitos) — lookup no banco (mais confiável, independe do nome)
      2. Alias por nome — lookup no banco (substring match, ordenado por priority)
      3. Dicionário local KNOWN_MARKETS (fallback embutido)
      4. Remoção token-a-token de sufixos jurídicos + title case
    """
    if not raw or raw.strip() == "":
        return "Mercado Desconhecido"

    raw_upper = raw.upper().strip()

    # 1. CNPJ base — método mais confiável
    if cnpj_base:
        for entry in _DB_ALIASES:
            if entry.get("cnpj_base") == cnpj_base:
                logger.info(f"🏪 Match por CNPJ {cnpj_base}: '{entry['display_name']}'")
                return entry["display_name"]

    # 2. Alias por nome (substring, já ordenado por priority)
    for entry in _DB_ALIASES:
        alias_upper = entry["alias"].upper()
        if alias_upper in raw_upper:
            logger.info(f"🏪 Match por alias '{entry['alias']}': '{entry['display_name']}'")
            return entry["display_name"]

    # 3. Fallback: dicionário local embutido
    for key, display_name in KNOWN_MARKETS.items():
        if key.upper() in raw_upper:
            return display_name

    # 4. Limpeza token-a-token (remover palavras jurídicas e ruídos)
    # Divide o nome em tokens e descarta os que são puro ruído
    tokens = raw_upper.split()
    kept = []
    skip_next = False
    for i, token in enumerate(tokens):
        if skip_next:
            skip_next = False
            continue
        # Remover tokens puramente numéricos (ex: "678", "123")
        if token.isdigit():
            continue
        # Remover tokens de ruído jurídico
        clean_token = token.strip(".,/")
        if clean_token in _NOISE_TOKENS:
            continue
        # Remover padrão "SN" seguido de número (marca Supernosso)
        if clean_token == "SN" and i + 1 < len(tokens) and tokens[i + 1].isdigit():
            skip_next = True
            continue
        kept.append(token.strip(".,/"))

    cleaned = " ".join(kept).title().strip()

    if not cleaned or len(cleaned) < 2:
        return "Mercado Desconhecido"

    # Truncar se ainda longo demais
    if len(cleaned) > 40:
        cleaned = cleaned[:40].rsplit(" ", 1)[0].strip()

    return cleaned




def extract_purchase_date(body_text: str, soup) -> str | None:
    """Tenta extrair a data de emissão da nota fiscal.
    Retorna string ISO 'YYYY-MM-DD' ou None se não encontrar.
    """
    # Padrão 1: "Emissão: 01/12/2025" ou "Emissao 01/12/2025 14:35"
    m = re.search(
        r'Emiss[aã]o\s*:?\s*(\d{2}/\d{2}/\d{4})',
        body_text, re.IGNORECASE
    )
    if m:
        try:
            return datetime.strptime(m.group(1), "%d/%m/%Y").date().isoformat()
        except ValueError:
            pass

    # Padrão 2: spans/tds com texto de data próximo a "Emissão"
    emissao_tag = soup.find(string=re.compile(r'Emiss[aã]o', re.I))
    if emissao_tag:
        parent = emissao_tag.parent
        # Tentar pegar o próximo elemento irmão ou o texto do próprio pai
        candidate_text = ""
        sibling = parent.find_next_sibling()
        if sibling:
            candidate_text = sibling.get_text()
        else:
            candidate_text = parent.get_text()

        m2 = re.search(r'(\d{2}/\d{2}/\d{4})', candidate_text)
        if m2:
            try:
                return datetime.strptime(m2.group(1), "%d/%m/%Y").date().isoformat()
            except ValueError:
                pass

    # Padrão 3: qualquer data no formato DD/MM/YYYY no body (último recurso)
    m3 = re.search(r'(\d{2}/\d{2}/\d{4})', body_text)
    if m3:
        try:
            return datetime.strptime(m3.group(1), "%d/%m/%Y").date().isoformat()
        except ValueError:
            pass

    return None

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
    """Extrai a URL de um QR Code contido na imagem e retorna (url, camada).
    
    Pipeline robusto para fotos de celular:
      - Corrige rotação EXIF (fotos mobile vêm "deitadas")
      - Testa múltiplos tamanhos (fotos de 12-48MP são muito grandes)
      - Pré-processamento avançado (binarização, threshold adaptivo, sharpening)
      - Rotações de 90° como fallback
    """
    try:
        base_image = Image.open(io.BytesIO(img_bytes))
        
        # ── CORREÇÃO EXIF (essencial para fotos de celular) ──────────────
        try:
            base_image = ImageOps.exif_transpose(base_image)
            logger.info(f"📐 Imagem após EXIF transpose: {base_image.size}")
        except Exception as e:
            logger.warning(f"⚠️ Falha ao aplicar EXIF transpose: {e}")
        
        width, height = base_image.size
        logger.info(f"📏 Dimensões originais: {width}x{height}")
        
        # ── GERAR VARIANTES PILLOW ───────────────────────────────────────
        pil_variants = []
        
        # Original
        pil_variants.append(("original", base_image))
        
        # Escala de cinza
        gray = base_image.convert('L')
        pil_variants.append(("gray", gray))
        
        # Contraste aumentado
        enhancer = ImageEnhance.Contrast(gray)
        pil_variants.append(("contrast_2x", enhancer.enhance(2.0)))
        pil_variants.append(("contrast_3x", enhancer.enhance(3.0)))
        
        # Sharpening
        sharp = gray.filter(ImageFilter.SHARPEN)
        pil_variants.append(("sharp", sharp))
        
        # Múltiplos níveis de downscale (essencial para fotos HD de celular)
        target_sizes = [3000, 2000, 1500, 1000, 800, 500]
        for size in target_sizes:
            if max(width, height) > size:
                resized = base_image.copy()
                resized.thumbnail((size, size), Image.Resampling.LANCZOS)
                pil_variants.append((f"resize_{size}", resized))
                pil_variants.append((f"resize_{size}_gray", resized.convert('L')))
                # Contraste no redimensionado
                resized_gray = resized.convert('L')
                enh = ImageEnhance.Contrast(resized_gray)
                pil_variants.append((f"resize_{size}_contrast", enh.enhance(2.0)))

        # ── CAMADA 1: PyZbar (Rápida) ───────────────────────────────────
        for name, img in pil_variants:
            decoded_objects = decode(img, symbols=[ZBarSymbol.QRCODE])
            for obj in decoded_objects:
                if obj.type == 'QRCODE':
                    url = obj.data.decode('utf-8')
                    logger.info(f"✅ QR lido por PyZbar (variante: {name})")
                    return url, 1
                    
        # ── CAMADA 2: OpenCV WeChatQRCode (Resiliente) ───────────────────
        if wechat_detector is not None:
            cv_variants = []
            
            # Converter imagem base (já com EXIF corrigido) para OpenCV
            corrected_bytes = io.BytesIO()
            base_image.save(corrected_bytes, format='PNG')
            corrected_bytes = corrected_bytes.getvalue()
            cv_base = cv2.imdecode(np.frombuffer(corrected_bytes, np.uint8), cv2.IMREAD_COLOR)
            
            if cv_base is not None:
                cv_variants.append(("cv_original", cv_base))
                
                # Grayscale
                cv_gray = cv2.cvtColor(cv_base, cv2.COLOR_BGR2GRAY)
                cv_variants.append(("cv_gray", cv2.cvtColor(cv_gray, cv2.COLOR_GRAY2BGR)))
                
                # Binarização Otsu
                _, otsu = cv2.threshold(cv_gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
                cv_variants.append(("cv_otsu", cv2.cvtColor(otsu, cv2.COLOR_GRAY2BGR)))
                
                # Threshold Adaptativo
                adaptive = cv2.adaptiveThreshold(cv_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 51, 10)
                cv_variants.append(("cv_adaptive", cv2.cvtColor(adaptive, cv2.COLOR_GRAY2BGR)))
                
                # CLAHE (equalização local de histograma)
                clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
                cl_img = clahe.apply(cv_gray)
                cv_variants.append(("cv_clahe", cv2.cvtColor(cl_img, cv2.COLOR_GRAY2BGR)))
                
                # Sharpening kernel
                kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
                sharpened = cv2.filter2D(cv_base, -1, kernel)
                cv_variants.append(("cv_sharp", sharpened))
                
                # Redimensionamentos para WeChatQRCode
                h, w = cv_base.shape[:2]
                for size in [1500, 1000, 800, 500]:
                    if max(h, w) > size:
                        scale = size / max(h, w)
                        resized_cv = cv2.resize(cv_base, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
                        cv_variants.append((f"cv_resize_{size}", resized_cv))
                
                # Testar cada variante
                for name, cv_img in cv_variants:
                    try:
                        res, points = wechat_detector.detectAndDecode(cv_img)
                        if res and len(res) > 0 and res[0]:
                            logger.info(f"✅ QR lido por WeChatQRCode (variante: {name})")
                            return res[0], 2
                    except Exception as e:
                        logger.debug(f"WeChatQRCode falhou em {name}: {e}")

        # ── CAMADA 3: Rotações 90° (último recurso) ──────────────────────
        logger.info("🔄 Tentando rotações de 90°...")
        for angle in [90, 180, 270]:
            rotated = base_image.rotate(angle, expand=True)
            rotated_gray = rotated.convert('L')
            
            # PyZbar na imagem rotacionada
            decoded = decode(rotated_gray, symbols=[ZBarSymbol.QRCODE])
            for obj in decoded:
                if obj.type == 'QRCODE':
                    logger.info(f"✅ QR lido após rotação de {angle}°")
                    return obj.data.decode('utf-8'), 1
            
            # WeChatQRCode na imagem rotacionada
            if wechat_detector is not None:
                rot_bytes = io.BytesIO()
                rotated.save(rot_bytes, format='PNG')
                rot_cv = cv2.imdecode(np.frombuffer(rot_bytes.getvalue(), np.uint8), cv2.IMREAD_COLOR)
                if rot_cv is not None:
                    try:
                        res, _ = wechat_detector.detectAndDecode(rot_cv)
                        if res and len(res) > 0 and res[0]:
                            logger.info(f"✅ QR lido por WeChatQRCode após rotação de {angle}°")
                            return res[0], 2
                    except Exception:
                        pass
                    
        logger.warning("❌ Nenhum QR Code detectado após todas as tentativas.")
        return None, 0
    except Exception as e:
        logger.error(f"Erro ao tentar ler o formato da imagem: {e}")
        return None, 0

def scrape_sefaz_mg(url: str) -> dict:
    """Acessa a URL da Sefaz MG e retorna os dados relevantes."""
    try:
        # Extrair CNPJ base da URL do QR Code (feito antes do request HTTP)
        cnpj_base = extract_cnpj_base_from_url(url)

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 1. Tentar pegar o Nome do Estabelecimento
        raw_market_name = "Mercado Desconhecido"
        # Na Sefaz MG geralmente fica num div com id u20 ou na classe txtTopo
        topo_div = soup.find('div', id='u20')
        if topo_div:
            raw_market_name = topo_div.get_text(strip=True)
        else:
            txt_topo = soup.find('div', class_='txtTopo')
            if txt_topo:
                raw_market_name = txt_topo.get_text(strip=True)
        
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

        # Extrair data da nota
        purchase_date = extract_purchase_date(body_text, soup)
        if purchase_date:
            logger.info(f"📅 Data da nota extraída: {purchase_date}")
        else:
            logger.warning("⚠️ Não foi possível extrair a data da nota.")

        if raw_market_name == "Mercado Desconhecido":
            m_cnpj = re.search(r'([^\.]+)\s+CNPJ:', body_text)
            if m_cnpj:
                raw_market_name = m_cnpj.group(1).strip()
                raw_market_name = re.sub(r'.*?\(NFC-e\)\s*', '', raw_market_name).strip()
                if not raw_market_name:
                    raw_market_name = "Mercado Desconhecido"
            
        if total_amount == 0.0:
            m_pago = re.search(r'Valor pago R\$?\s*([\d\.,]+)', body_text, re.I)
            if m_pago:
                total_amount = parse_brl_to_float(m_pago.group(1))

        # Normalizar nome do mercado — CNPJ first, depois alias por nome
        market_name = clean_market_name(raw_market_name, cnpj_base=cnpj_base)
                    
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
        
        # Último caso extremo: ainda desconhecido mas tem S/A no texto
        if market_name == "Mercado Desconhecido" and "S/A" in body_text:
            market_name = "Supermercado (Sefaz)"

        logger.info(f"🏪 Nome do mercado: '{raw_market_name}' → '{market_name}'")

        return {
            "success": True,
            "supermarket_name": market_name,
            "total_amount": total_amount,
            "purchase_date": purchase_date,
            "url": url,
            "items": items_comprados
        }

    except Exception as e:
        logger.error(f"Erro ao extrair HTML Sefaz MG: {e}")
        return {
            "success": False,
            "error": str(e)
        }
