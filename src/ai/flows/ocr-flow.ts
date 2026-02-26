
'use server';
/**
 * @fileOverview 硅基流动 (SiliconFlow) 视觉 OCR 流程。
 * 严格使用 PaddlePaddle/PaddleOCR-VL-1.5 模型进行视觉识别。
 */

import { ai } from '@/ai/genkit';
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
  return ocrFlow(input);
}

const ocrFlow = ai.defineFlow(
  {
    name: 'ocrFlow',
    inputSchema: OCRInputSchema,
    outputSchema: OCROutputSchema,
  },
  async (input) => {
    const SILICON_FLOW_API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
    const SILICON_FLOW_API_KEY = 'sk-orcwdodraxjcyrllecfaaukwuuepdysjqeeslnaarzhhjeey';
    // 严格按照用户要求的模型 ID
    const MODEL_ID = 'PaddlePaddle/PaddleOCR-VL-1.5'; 

    const results: { pageIndex: number; text: string }[] = [];

    // 逐页发送请求，避免请求体过大及单次请求超时
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
                  { type: "text", text: "请将这张图片的内容完整提取并转换为 Markdown 格式，包含表格。不要输出任何解释，直接输出识别结果。" },
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
          throw new Error(`OCR API 错误 (${response.status}): ${errorMsg}`);
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
);
