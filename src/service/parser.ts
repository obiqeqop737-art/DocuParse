import { Readable } from 'stream';

/**
 * PDF 解析服务
 * 支持：文本层提取 -> 分片 -> 并发OCR -> 进度反馈 -> 内存管理
 */

import PDFDocument from 'pdf-lib';
import pdf from 'pdf-parse';
import axios from 'axios';

// 配置
const CONFIG = {
  PAGES_PER_CHUNK: 10,           // 每10页一个chunk
  CONCURRENT_LIMIT: 3,            // 并发上限
  MAX_RETRIES: 3,                // 最大重试次数
  RETRY_DELAY: 1000,             // 基础重试延迟(ms)
  SILICON_FLOW_API_URL: 'https://api.siliconflow.cn/v1/chat/completions',
  OCR_MODEL: 'PaddlePaddle/PaddleOCR-VL-1.5',
};

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
 * 步骤1: 尝试用 pdf-parse 提取文本层
 */
async function extractTextLayer(pdfBuffer: Buffer): Promise<{
  success: boolean;
  text?: string;
  pageCount?: number;
}> {
  try {
    const data = await pdf(pdfBuffer);
    
    if (data.text && data.text.trim().length > 0) {
      return {
        success: true,
        text: data.text,
        pageCount: data.numpages,
      };
    }
    
    return { success: false };
  } catch (error: any) {
    console.log('[Parser] 文本层提取失败:', error.message);
    return { success: false };
  }
}

/**
 * 步骤2: 使用 OCR 解析
 */
async function parseWithOCR(
  pdfBuffer: Buffer, 
  apiKey: string, 
  onProgress?: (current: number, total: number, status: string) => void
): Promise<ParseResult> {
  
  // ===== 2.1: 用 pdf-lib 分割 PDF =====
  onProgress?.(0, 100, '正在分割PDF...');
  
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  const chunks: { start: number; end: number }[] = [];
  
  // 分片
  for (let i = 0; i < totalPages; i += CONFIG.PAGES_PER_CHUNK) {
    chunks.push({
      start: i + 1,
      end: Math.min(i + CONFIG.PAGES_PER_CHUNK, totalPages),
    });
  }
  
  console.log(`[Parser] PDF共${totalPages}页，分成${chunks.length}个chunk`);
  
  // ===== 2.2: 并发处理 chunks =====
  const results: string[] = [];
  let processedCount = 0;
  
  // 导入 p-limit
  const pLimit = await import('p-limit');
  const limit = pLimit.default(CONFIG.CONCURRENT_LIMIT);
  
  // 创建并发任务
  const tasks = chunks.map((chunk, index) => 
    limit(async () => {
      try {
        onProgress?.(processedCount, totalPages, `正在处理第 ${chunk.start}-${chunk.end} 页...`);
        
        // 提取当前chunk的页面
        const chunkPdf = await pdfDoc.copyPages(
          pdfDoc.getPages().slice(chunk.start - 1, chunk.end),
          pdfDoc.getPages().slice(chunk.start - 1, chunk.end)
        );
        
        // 创建新PDF
        const newPdf = await PDFDocument.create();
        for (const page of chunkPdf) {
          newPdf.addPage(page);
        }
        
        // 转图片
        const images = await pdfToImages(newPdf);
        
        // OCR识别
        const ocrText = await processOCRChunk(images, apiKey);
        
        results.push(`\n## 第 ${chunk.start}-${chunk.end} 页\n\n${ocrText}`);
        
        // 释放内存
        images.length = 0;
        
        processedCount = Math.min(processedCount + (chunk.end - chunk.start + 1), totalPages);
        onProgress?.(processedCount, totalPages, `已完成 ${processedCount}/${totalPages} 页`);
        
        return ocrText;
      } catch (error: any) {
        console.error(`[Parser] Chunk ${index + 1} 处理失败:`, error);
        throw error;
      }
    })
  );
  
  // 等待所有任务完成
  await Promise.all(tasks);
  
  // ===== 2.3: 清理内存 =====
  pdfDoc.destroy();
  pdfBuffer = Buffer.alloc(0);
  
  // ===== 2.4: 合并结果 =====
  const finalText = results.join('\n\n');
  
  onProgress?.(totalPages, totalPages, 'OCR完成');
  
  return {
    text: finalText,
    method: 'ocr',
    pagesProcessed: totalPages,
  };
}

/**
 * PDF 转图片序列（简化版，实际需要用 pdf.js 或其他库）
 */
async function pdfToImages(pdfDoc: any): Promise<string[]> {
  // 这里需要实现 PDF 转图片的逻辑
  // 由于浏览器端已经做了转换，这里简化处理
  // 实际部署时需要在服务端也实现类似逻辑
  
  // 临时返回空数组，实际会走另一条路径
  return [];
}

/**
 * OCR 处理单个 chunk（带重试机制）
 */
async function processOCRChunk(images: string[], apiKey: string): Promise<string> {
  if (images.length === 0) {
    return '[图片转换失败]';
  }
  
  const ocrPrompt = `请提取图片中的所有文字内容，以Markdown格式输出。`;
  
  // 串行处理每张图片
  const results: string[] = [];
  
  for (const imageData of images) {
    const result = await callOCRWithRetry(imageData, ocrPrompt, apiKey);
    results.push(result);
  }
  
  return results.join('\n\n');
}

/**
 * 带重试的 OCR 调用
 */
async function callOCRWithRetry(
  imageData: string, 
  prompt: string, 
  apiKey: string,
  retries: number = CONFIG.MAX_RETRIES
): Promise<string> {
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await axios.post(
        CONFIG.SILICON_FLOW_API_URL,
        {
          model: CONFIG.OCR_MODEL,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: imageData } }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 4096,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          timeout: 60000, // 60秒超时
        }
      );
      
      if (response.status === 200) {
        return response.data.choices?.[0]?.message?.content || '';
      }
      
    } catch (error: any) {
      const status = error.response?.status;
      
      // 502/504 或网络错误，重试
      if ((status === 502 || status === 504 || !status) && attempt < retries - 1) {
        const delay = CONFIG.RETRY_DELAY * Math.pow(2, attempt); // 指数退避
        console.log(`[OCR] 请求失败，${delay}ms 后重试 (${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      throw error;
    }
  }
  
  return '[OCR处理失败]';
}

/**
 * SSE 进度推送辅助函数
 */
export function createSSEProgress(
  res: any, 
  onProgress: (current: number, total: number, status: string) => void
) {
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
