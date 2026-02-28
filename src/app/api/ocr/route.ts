import { NextRequest, NextResponse } from 'next/server';

/**
 * @fileOverview OCR 视觉识别 API - 优化版
 * 支持大文件分片处理、并行加速、内存管理
 */

export const maxDuration = 300; // 延长到5分钟

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

    const MODEL_ID = 'PaddlePaddle/PaddleOCR-VL-1.5';

    const ocrPrompt = `请提取图片中的所有文字内容，以Markdown格式输出。`;

    // ========== 分片处理逻辑 ==========
    const CHUNK_SIZE = 10; // 每10页一组
    const totalPages = images.length;
    const chunks: typeof images[] = [];
    
    // 拆分成多个chunk
    for (let i = 0; i < totalPages; i += CHUNK_SIZE) {
      chunks.push(images.slice(i, i + CHUNK_SIZE));
    }
    
    console.log(`[OCR] 总共 ${totalPages} 页，分成 ${chunks.length} 个chunk处理`);

    // ========== 并行处理函数 ==========
    const processChunk = async (chunk: typeof images, chunkIndex: number): Promise<typeof results> => {
      console.log(`[OCR] 开始处理 chunk ${chunkIndex + 1}/${chunks.length}`);
      
      const chunkResults: { pageIndex: number; text: string }[] = [];
      
      // chunk内部串行处理（避免API限流）
      for (const item of chunk) {
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

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.error?.message || 'OCR 失败';
            throw new Error(errorMsg);
          }

          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || '';
          chunkResults.push({ pageIndex: item.pageIndex, text: content });
          
          // 每次处理完一页后，显式释放不需要的数据
          item.dataUri = '';
          
        } catch (error: any) {
          console.error(`Page ${item.pageIndex} OCR failed:`, error);
          chunkResults.push({ pageIndex: item.pageIndex, text: `[识别失败: ${error.message}]` });
        }
      }
      
      console.log(`[OCR] chunk ${chunkIndex + 1} 处理完成`);
      return chunkResults;
    };

    // ========== 并行处理多个chunk ==========
    const allChunkResults = await Promise.all(
      chunks.map((chunk, index) => processChunk(chunk, index))
    );

    // ========== 合并结果 ==========
    let results: { pageIndex: number; text: string }[] = [];
    
    for (const chunkResult of allChunkResults) {
      results = results.concat(chunkResult);
    }
    
    // 按页码排序
    results.sort((a, b) => a.pageIndex - b.pageIndex);

    // 智能合并 Markdown，保留标题层级
    const mergedContent = mergeMarkdownResults(results);

    console.log(`[OCR] 全部处理完成，共 ${results.length} 页`);

    // 显式释放内存
    images.length = 0;
    chunks.length = 0;
    allChunkResults.length = 0;

    return NextResponse.json({ results, mergedContent });

  } catch (error: any) {
    console.error('OCR API Error:', error);
    return NextResponse.json(
      { error: error.message || 'OCR 处理失败' },
      { status: 500 }
    );
  }
}

/**
 * 智能合并 Markdown 结果，保持标题层级
 */
function mergeMarkdownResults(results: { pageIndex: number; text: string }[]): string {
  const parts: string[] = [];
  
  for (const result of results) {
    // 添加页码标记
    parts.push(`\n## 第 ${result.pageIndex} 页\n`);
    
    // 清理文本，去除重复的标题
    let text = result.text.trim();
    
    // 如果不是第一页，移除可能重复的 H1 标题
    if (result.pageIndex > 1) {
      // 移除顶级的 # 标题，避免重复
      text = text.replace(/^#\s+.+$/gm, '');
    }
    
    parts.push(text);
  }
  
  return parts.join('\n\n');
}
