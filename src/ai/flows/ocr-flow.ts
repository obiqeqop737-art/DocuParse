'use server';
/**
 * @fileOverview 硅基流动 (SiliconFlow) 视觉 OCR 流程。
 * 使用 Qwen2-VL 进行图像识别，支持提示词。
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
  
  // 使用 Qwen2-VL 视觉模型，支持提示词
  const MODEL_ID = 'Qwen/Qwen2-VL-72B-Instruct';

  if (!SILICON_FLOW_API_KEY) {
    throw new Error('Server configuration error: SILICON_FLOW_API_KEY not set');
  }

  const results: { pageIndex: number; text: string }[] = [];

  // 提示词要求模型精准提取图像中的文本内容
  const ocrPrompt = `你是一个极其精确的文档内容提取器。请仔细识别并提取图片中的所有文字内容。
要求：
1. 保持原文排版和格式，使用 Markdown 格式输出
2. 对于表格，必须保持行列对应
3. 数字、标点、单位必须精确保留
4. 如果遇到图片中的水印或无关内容，请忽略
5. 不要添加任何解释或总结，只输出提取的文本`;

  for (const item of input.images) {
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
        const errorMsg = errorData.error?.message || errorData.message || '未知视觉识别错误';
        throw new Error(`[视觉模型 ID: ${MODEL_ID}] 错误: ${errorMsg}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      results.push({ pageIndex: item.pageIndex, text: content });
    } catch (error: any) {
      console.error(`Page ${item.pageIndex} OCR Failed:`, error);
      results.push({ pageIndex: item.pageIndex, text: `[该页视觉识别失败: ${error.message}]` });
    }
  }

  return { results };
}
