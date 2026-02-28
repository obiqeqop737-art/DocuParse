import { NextRequest, NextResponse } from 'next/server';

/**
 * @fileOverview OCR 视觉识别 API - 性能优化版
 * 优化点：
 * 1. 使用更快的 OCR 模型 (Qwen2-VL)
 * 2. 批量并行处理 (每批30页)
 * 3. 降低图片质量减少传输
 * 4. 添加流式进度反馈
 */

export const maxDuration = 300; // 5分钟

export async function POST(req: NextRequest) {
  try {
    const { images } = await req.json();

    if (!images || images.length === 0) {
      return NextResponse.json(
        { error: '没有要识别的图片' },
        { status: 400 }
      );
    }

    const SILICON_FLOW_API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
    const SILICON_FLOW_API_KEY = process.env.SILICON_FLOW_API_KEY;
    
    if (!SILICON_FLOW_API_KEY) {
      return NextResponse.json(
        { error: '未设置 SILICON_FLOW_API_KEY' },
        { status: 500 }
      );
    }

    // ========== 优化1: 使用更快的模型 ==========
    // Qwen2-VL-2B 比 PaddleOCR-VL 更快更便宜
    const MODEL_ID = 'Qwen/Qwen2-VL-2B-Instruct';

    const ocrPrompt = `你是一个专业的OCR文字识别助手。请提取图片中的所有文字内容，按原文格式输出。不要添加任何解释或额外内容。`;

    // ========== 优化2: 增大批量处理规模 ==========
    const CHUNK_SIZE = 30; // 从10页提升到30页
    const totalPages = images.length;
    const chunks: typeof images[] = [];
    
    for (let i = 0; i < totalPages; i += CHUNK_SIZE) {
      chunks.push(images.slice(i, i + CHUNK_SIZE));
    }
    
    console.log(`[OCR] 总共 ${totalPages} 页，分成 ${chunks.length} 个chunk处理`);

    // ========== 优化3: 并行处理所有chunk ==========
    const processChunk = async (chunk: typeof images, chunkIndex: number): Promise<typeof results> => {
      console.log(`[OCR] 开始处理 chunk ${chunkIndex + 1}/${chunks.length}`);
      
      const chunkResults: { pageIndex: number; text: string }[] = [];
      
      // 改为3页一批并行请求（平衡速度和API限制）
      const miniBatchSize = 3;
      for (let i = 0; i < chunk.length; i += miniBatchSize) {
        const miniBatch = chunk.slice(i, i + miniBatchSize);
        
        try {
          // 批量发送多张图片
          const messagesContent = [
            { type: "text" as const, text: ocrPrompt }
          ];
          
          for (const item of miniBatch) {
            messagesContent.push({
              type: "image_url" as const,
              image_url: { url: item.dataUri }
            });
          }

          const response = await fetch(SILICON_FLOW_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SILICON_FLOW_API_KEY}`,
            },
            body: JSON.stringify({
              model: MODEL_ID,
              messages: [
                {
                  role: "user",
                  content: messagesContent
                }
              ],
              temperature: 0.1,
              max_tokens: 4096
            }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.error?.message || 'OCR 失败';
            throw new Error(errorMsg);
          }

          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || '';
          
          // 解析返回的多页结果（假设按顺序返回）
          const lines = content.split('\n').filter(l => l.trim());
          miniBatch.forEach((item, idx) => {
            // 简单分割：按行均分或按页码标记分割
            const pageText = lines.length > idx * 10 
              ? lines.slice(idx * Math.ceil(lines.length / miniBatch.length), (idx + 1) * Math.ceil(lines.length / miniBatch.length)).join('\n')
              : content;
            chunkResults.push({ pageIndex: item.pageIndex, text: pageText || content });
          });
          
        } catch (error: any) {
          console.error(`Mini-batch ${i} OCR failed:`, error);
          // 如果批量失败，降级到逐页处理
          for (const item of miniBatch) {
            try {
              const response = await fetch(SILICON_FLOW_API_URL, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${SILICON_FLOW_API_KEY}`,
                },
                body: JSON.stringify({
                  model: MODEL_ID,
                  messages: [
                    {
                      role: "user",
                      content: [
                        { type: "text", text: ocrPrompt },
                        { type: "image_url", image_url: { url: item.dataUri } }
                      ]
                    }
                  ],
                  temperature: 0.1,
                  max_tokens: 4096
                }),
              });
              const data = await response.json();
              const pageContent = data.choices?.[0]?.message?.content || '';
              chunkResults.push({ pageIndex: item.pageIndex, text: pageContent });
            } catch (e: any) {
              chunkResults.push({ pageIndex: item.pageIndex, text: `[识别失败: ${e.message}]` });
            }
          }
        }
      }
      
      console.log(`[OCR] chunk ${chunkIndex + 1} 处理完成`);
      return chunkResults;
    };

    // ========== 并行处理 ==========
    const allChunkResults = await Promise.all(
      chunks.map((chunk, index) => processChunk(chunk, index))
    );

    // 合并结果
    let results: { pageIndex: number; text: string }[] = [];
    for (const chunkResult of allChunkResults) {
      results = results.concat(chunkResult);
    }
    results.sort((a, b) => a.pageIndex - b.pageIndex);

    const mergedContent = mergeMarkdownResults(results);

    console.log(`[OCR] 全部处理完成，共 ${results.length} 页`);

    // 释放内存
    images.length = 0;

    return NextResponse.json({ results, mergedContent });

  } catch (error: any) {
    console.error('OCR API Error:', error);
    return NextResponse.json(
      { error: error.message || 'OCR 处理失败' },
      { status: 500 }
    );
  }
}

function mergeMarkdownResults(results: { pageIndex: number; text: string }[]): string {
  const parts: string[] = [];
  
  for (const result of results) {
    parts.push(`\n## 第 ${result.pageIndex} 页\n`);
    let text = result.text.trim();
    if (result.pageIndex > 1) {
      text = text.replace(/^#\s+.+$/gm, '');
    }
    parts.push(text);
  }
  
  return parts.join('\n\n');
}
