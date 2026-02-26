
'use server';
/**
 * @fileOverview 硅基流动 (SiliconFlow) 视觉 OCR 流程。
 * 严格使用 PaddlePaddle/PaddleOCR-VL-1.5 模型。
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
    // 严格锁定视觉模型 ID
    const MODEL_ID = 'PaddlePaddle/PaddleOCR-VL-1.5'; 

    const results: { pageIndex: number; text: string }[] = [];

    for (const item of input.images) {
      try {
        // 确保 dataUri 格式正确，PaddleOCR 偏好标准的 OpenAI Vision 格式
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
                  { type: "text", text: "请精准提取图片中的所有文本，以 Markdown 格式返回。不要解释，直接返回结果。" },
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
);
