import fitz  # PyMuPDF
import base64
import requests
import json
import logging
import io
from PIL import Image

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def call_paddle_ocr_vl(image_base64, api_key, model_id="PaddlePaddle/PaddleOCR-VL-1.5"):
    """
    调用 SiliconFlow PaddleOCR-VL-1.5 模型，注入反幻觉强指令。
    """
    url = "https://api.siliconflow.cn/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    # 反幻觉像素级复刻指令
    anti_hallucination_prompt = (
        "你是一个极其精确的工业数据提取器。你的唯一任务是【像素级复刻】图片中的内容。\n"
        "1. 绝对禁止任何形式的推理、联想或语病修正。\n"
        "2. 对于所有的【数字、小数点、物理单位、负号】，必须逐字核对，原样输出。如果看不清，请输出'[不清]'，禁止猜测。\n"
        "3. 如果是表格，请严格保证行列对应，使用 Markdown 格式输出。"
    )
    
    payload = {
        "model": model_id,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": anti_hallucination_prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}}
                ]
            }
        ],
        "temperature": 0.01,
        "top_p": 0.1,
        "max_tokens": 4096
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=60)
        if response.status_code != 200:
            logger.error(f"API Error: {response.text}")
            return None
        
        result = response.json()
        content = result.get('choices', [{}])[0].get('message', {}).get('content', '')
        return content
    except Exception as e:
        logger.error(f"Request failed: {str(e)}")
        return None

def split_image_if_needed(image_bytes, max_height=2500):
    """
    如果图片过长（>2500px），将其上下切割，防止 VLM 识别率下降。
    """
    img = Image.open(io.BytesIO(image_bytes))
    width, height = img.size
    
    if height <= max_height:
        return [base64.b64encode(image_bytes).decode('utf-8')]
    
    logger.info(f"Image height ({height}px) exceeds threshold, splitting...")
    num_parts = (height // max_height) + 1
    part_height = height // num_parts
    
    results = []
    for i in range(num_parts):
        upper = i * part_height
        lower = (i + 1) * part_height if i < num_parts - 1 else height
        part = img.crop((0, upper, width, lower))
        buffered = io.BytesIO()
        part.save(buffered, format="JPEG", quality=85)
        results.append(base64.b64encode(buffered.getvalue()).decode('utf-8'))
    
    return results

def process_pdf_to_ocr(pdf_path, api_key):
    """
    PDF 预处理及 OCR 管道：统一光栅化 (300 DPI) + 反幻觉识别。
    """
    final_results = []
    
    try:
        doc = fitz.open(pdf_path)
        logger.info(f"Processing PDF: {pdf_path}, Pages: {len(doc)}")
        
        for i in range(len(doc)):
            page_num = i + 1
            logger.info(f"Rasterizing page {page_num}...")
            
            try:
                page = doc.load_page(i)
                # 3.0 Matrix 对应约 300 DPI
                matrix = fitz.Matrix(3.0, 3.0) 
                pix = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB)
                img_bytes = pix.tobytes("jpeg")
                
                b64_list = split_image_if_needed(img_bytes)
                
                page_content = ""
                for b64_data in b64_list:
                    ocr_res = call_paddle_ocr_vl(b64_data, api_key)
                    if ocr_res:
                        page_content += ocr_res + "\n"
                
                final_results.append({
                    "page_num": page_num,
                    "content": page_content.strip(),
                    "status": "success" if page_content.strip() else "empty"
                })
                
            except Exception as page_err:
                logger.error(f"Page {page_num} failed: {str(page_err)}")
                final_results.append({
                    "page_num": page_num,
                    "content": "",
                    "status": "error",
                    "error": str(page_err)
                })
        
        doc.close()
    except Exception as e:
        logger.error(f"Global PDF error: {str(e)}")
        return json.dumps({"error": str(e)}, ensure_ascii=False)

    return json.dumps(final_results, indent=2, ensure_ascii=False)
