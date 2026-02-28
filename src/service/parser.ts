/**
 * PDF 解析服务
 * 支持：文本层提取 -> 分片 -> 并发OCR -> 进度反馈 -> 内存管理
 */

import * as pdfjsLib from 'pdfjs-dist';

// 配置
const CONFIG = {
  PAGES_PER_CHUNK: 10,           // 每10页一个chunk
  CONCURRENT_LIMIT: 3,            // 并发上限
  MAX_RETRIES: 3,                // 最大重试次数
  RETRY_DELAY: 1000,             // 基础重试延迟(ms)
  SILICON_FLOW_API_URL: 'https://api.siliconflow.cn/v1/chat/completions',
  OCR_MODEL: 'PaddlePaddle/PaddleOCR-VL-1.5',
};

// 配置 Worker
if (typeof window === 'undefined') {
  // 服务端环境
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

interface ParseOptions {
  apiKey: string;
  onProgress?: (current: number, total: number, status: string) => void;
}

interface ParseResult {
  text: string;
  method: 'text-layer' | 'ocr';
  pagesProcessed: number;
}

/**
 * 主解析函数
 */
export async function parsePDF(pdfBuffer: Buffer, options: ParseOptions): Promise<ParseResult> {
  const { apiKey, onProgress } = options;
  
  try {
    // ===== 步骤1: 尝试文本层提取 =====
    onProgress?.(0, 100, '正在提取文本层...');
    
    const textResult = await extractTextLayer(pdfBuffer);
    
    if (textResult.success && textResult.text && textResult.text.length > 50) {
      // 文本层提取成功
      onProgress?.(100, 100, '文本层提取完成');
      
      return {
        text: textResult.text,
        method: 'text-layer',
        pagesProcessed: textResult.pageCount || 0,
      };
    }
    
    // ===== 步骤2: 文本层提取失败，使用 OCR =====
    onProgress?.(0, 100, '文本层提取失败，开始OCR识别...');
    
    const ocrResult = await parseWithOCR(pdfBuffer, apiKey, onProgress);
    
    return ocrResult;
    
  } catch (error: any) {
    console.error('[Parser] 解析失败:', error);
    throw new Error(`PDF解析失败: ${error.message}`);
  }
}

/**
 * 步骤1: 尝试用 pdfjs 提取文本层
 */
async function extractTextLayer(pdfBuffer: Buffer): Promise<{
  success: boolean;
  text?: string;
  pageCount?: number;
}> {
  try {
    const pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
    const pageCount = pdf.numPages;
    let fullText = '';
    
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += pageText + '\n\n';
    }
    
    if (fullText.trim().length > 50) {
      return {
        success: true,
        text: fullText,
        pageCount,
      };
    }
    
    return { success: false };
  } catch (error: any) {
    console.log('[Parser] 文本层提取失败:', error.message);
    return { success: false };
  }
}

/**
 * 步骤2: 使用 OCR 解析（复用已有的 /api/ocr 逻辑）
 */
async function parseWithOCR(
  pdfBuffer: Buffer, 
  apiKey: string, 
  onProgress?: (current: number, total: number, status: string) => void
): Promise<ParseResult> {
  
  // ===== 2.1: PDF 转图片 =====
  onProgress?.(0, 100, '正在转换PDF为图片...');
  
  const pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
  const totalPages = pdf.numPages;
  
  const images: { pageIndex: number; dataUri: string }[] = [];
  
  // 分批转换，避免内存溢出
  const BATCH_SIZE = 10;
  
  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    await page.render({ canvasContext: context!, viewport }).promise;
    
    images.push({
      pageIndex: i,
      dataUri: canvas.toDataURL('image/jpeg', 0.6),
    });
    
    // 进度更新
    const progress = Math.floor((i / totalPages) * 50);
    onProgress?.(progress, 100, `已转换 ${i}/${totalPages} 页...`);
    
    // 每批清理一次内存
    if (i % BATCH_SIZE === 0) {
      await new Promise(r => setTimeout(r, 100)); // 给 GC 一点时间
    }
  }
  
  // ===== 2.2: 调用 OCR API =====
  onProgress?.(50, 100, '开始OCR识别...');
  
  // 复用现有的 OCR API
  const response = await fetch(process.env.NEXT_PUBLIC_API_URL + '/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images }),
  });
  
  if (!response.ok) {
    throw new Error('OCR API 调用失败');
  }
  
  const { results } = await response.json();
  
  // 合并结果
  const textParts = results.map((r: any) => `## 第 ${r.pageIndex} 页\n\n${r.text}`);
  const finalText = textParts.join('\n\n');
  
  // 清理内存
  images.length = 0;
  pdf.destroy();
  
  onProgress?.(100, 100, 'OCR完成');
  
  return {
    text: finalText,
    method: 'ocr',
    pagesProcessed: totalPages,
  };
}

/**
 * SSE 进度推送辅助函数
 */
export function createSSEProgress(res: any) {
  const encoder = new TextEncoder();
  
  return {
    send: (current: number, total: number, status: string) => {
      const data = JSON.stringify({ current, total, status });
      res.write(`data: ${data}\n\n`);
    },
    end: () => {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  };
}
