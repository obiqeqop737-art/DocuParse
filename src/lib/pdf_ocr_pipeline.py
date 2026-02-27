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
    调用 SiliconFlow 或其他兼容 API 的 PaddleOCR-VL 模型
    """
    url = "https://api.siliconflow.cn/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    # 强指令 System Prompt
    system_prompt = (
        "你是一个专业的文档解析助手。请精准提取图片中的所有文本和数据。"
        "如果是表格，请严格使用 Markdown 格式输出。"
        "如果图片中没有任何有效文本，请回复 'NO_TEXT_FOUND'。"
    )
    
    payload = {
        "model": model_id,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": system_prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}}
                ]
            }
        ],
        "temperature": 0.1,
        "max_tokens": 4096
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=60)
        if response.status_code != 200:
            logger.error(f"API Error: {response.text}")
            return None
        
        result = response.json()
        content = result.get('choices', [{}])[0].get('message', {}).get('content', '')
        
        if 'NO_TEXT_FOUND' in content:
            return ""
            
        return content
    except Exception as e:
        logger.error(f"Request failed: {str(e)}")
        return None

def split_image_if_needed(image_bytes, max_height=4000):
    """
    如果图片过长，将其上下均分，防止 VLM 识别率下降
    """
    img = Image.open(io.BytesIO(image_bytes))
    width, height = img.size
    
    if height <= max_height:
        return [base64.b64encode(image_bytes).decode('utf-8')]
    
    logger.info(f"Image too high ({height}px), splitting into two parts...")
    half_height = height // 2
    top = img.crop((0, 0, width, half_height))
    bottom = img.crop((0, half_height, width, height))
    
    results = []
    for part in [top, bottom]:
        buffered = io.BytesIO()
        part.save(buffered, format="JPEG", quality=85)
        results.append(base64.b64encode(buffered.getvalue()).decode('utf-8'))
    
    return results

def process_pdf_to_ocr(pdf_path, api_key):
    """
    主函数：PDF 预处理及 OCR 管道
    """
    final_results = []
    
    try:
        # 1. 统一光栅化拦截 (Rasterization)
        doc = fitz.open(pdf_path)
        logger.info(f"Processing PDF: {pdf_path} with {len(doc)} pages.")
        
        for i in range(len(doc)):
            page_num = i + 1
            logger.info(f"Rasterizing page {page_num}...")
            
            try:
                page = doc.load_page(i)
                # 强制渲染为高分辨率图片 (300 DPI)
                matrix = fitz.Matrix(2.0, 2.0) 
                pix = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB)
                img_bytes = pix.tobytes("jpeg")
                
                # 2. 长图切分逻辑
                b64_list = split_image_if_needed(img_bytes)
                
                page_content = ""
                for idx, b64_data in enumerate(b64_list):
                    # 3. 强指令调用 OCR
                    ocr_res = call_paddle_ocr_vl(b64_data, api_key)
                    if ocr_res:
                        page_content += ocr_res + "\n"
                
                # 4. 异常处理与空值兜底
                status = "success" if page_content.strip() else "empty_or_no_text"
                final_results.append({
                    "page_num": page_num,
                    "content": page_content.strip(),
                    "status": status
                })
                
            except Exception as page_err:
                logger.warning(f"Failed to process page {page_num}: {str(page_err)}")
                final_results.append({
                    "page_num": page_num,
                    "content": "",
                    "status": "error",
                    "error_msg": str(page_err)
                })
        
        doc.close()
    except Exception as e:
        logger.error(f"Global PDF processing error: {str(e)}")
        return json.dumps({"error": str(e)}, ensure_ascii=False)

    return json.dumps(final_results, indent=2, ensure_ascii=False)

# 使用示例
# if __name__ == "__main__":
#     API_KEY = "your_siliconflow_api_key"
#     res = process_pdf_to_ocr("sample.pdf", API_KEY)
#     print(res)
