'use server';
/**
 * @fileOverview 硅基流动 (SiliconFlow) 视觉 OCR 流程。
 * 使用 Qwen2-VL 进行图像识别，支持提示词，并发处理提升速度。
 */

import { z } from 'genkit';

const OCRInputSchema = z.object({
  images: z.array(z.object({
    pageIndex: z.number(),
    dataUri: z.string()
  })).describe('待识别的图片及其原始页码列表。'),
});
export type OCRInput = z.infer<typeof OCRInputSchema>;

const OCROutputSchema = z.object({
  results: z.array(z.object({
    pageIndex: z.number(),
    text: z.string()
  })).describe('识别后的文本及页码映射。'),
});
export type OCROutput = z.infer<typeof OCROutputSchema>;

export async function performOCR(input: OCRInput): Promise<OCROutput> {
  const SILICON_FLOW_API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
  const SILICON_FLOW_API_KEY = process.env.SILICON_FLOW_API_KEY;
  
  // 使用 Qwen2-VL-7B 模型（比72B快很多）
  const MODEL_ID = 'Qwen/Qwen2.5-VL-7B-Instruct';

  if (!SILICON_FLOW_API_KEY) {
    throw new Error('❌ 配置错误：未设置 SILICON_FLOW_API_KEY 环境变量\\n\\n💡 解决方案：在 Vercel 项目设置中添加该环境变量');
  }

  if (!input.images || input.images.length === 0) {
    throw new Error('❌ 参数错误：没有要识别的图片');
  }

  // 提示词
  const ocrPrompt = `你是一个极其精确的文档内容提取器。请仔细识别并提取图片中的所有文字内容。
要求：
1. 保持原文排版和格式，使用 Markdown 格式输出
2. 对于表格，必须保持行列对应
3. 数字、标点、单位必须精确保留
4. 如果遇到图片中的水印或无关内容，请忽略
5. 不要添加任何解释或总结，只输出提取的文本`;

  console.log(`[OCR] 开始识别 ${input.images.length} 页图片，使用模型: ${MODEL_ID}`);

  // 并发处理所有页面（最多同时3个，避免API限流）
  const processPage = async (item: { pageIndex: number; dataUri: string }) => {
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
      const errorMsg = errorData.error?.message || errorData.message || '未知错误';
      throw new Error(`[OCR] 第 ${item.pageIndex} 页失败: ${errorMsg}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    return { pageIndex: item.pageIndex, text: content };
  };

  // 分批并发处理，每批3个
  const results: { pageIndex: number; text: string }[] = [];
  const batchSize = 3;
  
  for (let i = 0; i < input.images.length; i += batchSize) {
    const batch = input.images.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processPage));
    results.push(...batchResults);
    console.log(`[OCR] 完成 ${Math.min(i + batchSize, input.images.length)}/${input.images.length} 页`);
  }

  // 按页码排序
  results.sort((a, b) => a.pageIndex - b.pageIndex);

  console.log(`[OCR] 全部识别完成，共 ${results.length} 页`);
  return { results };
}
