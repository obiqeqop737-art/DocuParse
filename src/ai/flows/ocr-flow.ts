'use server';
/**
 * @fileOverview 硅基流动 (SiliconFlow) 视觉 OCR 流程。
 * 针对 100% 数字高保真提取进行了提示词强化与参数调优。
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
    const SILICON_FLOW_API_KEY = process.env.SILICON_FLOW_API_KEY;
    const MODEL_ID = 'PaddlePaddle/PaddleOCR-VL-1.5'; 

    if (!SILICON_FLOW_API_KEY) {
      throw new Error('Server configuration error: SILICON_FLOW_API_KEY not set');
    } 

    const results: { pageIndex: number; text: string }[] = [];

    const antiHallucinationPrompt = `你是一个极其精确的工业数据提取器。你的唯一任务是【像素级复刻】图片中的内容。
1. 绝对禁止任何形式的推理、联想或语病修正。
2. 对于所有的【数字、小数点、物理单位、负号】，必须逐字核对，原样输出。如果看不清，请保留原样或输出'[不清]'，绝对不允许自行猜测填补。
3. 如果是表格，请严格保证行列对应，不要漏掉任何一个单元格的数值。
请直接以 Markdown 格式返回提取结果，不要包含任何多余的解释。`;

    for (const item of input.images) {
      try {
        const cleanDataUri = item.dataUri.trim();

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
                  { type: "text", text: antiHallucinationPrompt },
                  { type: "image_url", image_url: { url: cleanDataUri } }
                ]
              }
            ],
            temperature: 0.01, // 极致确定性输出
            top_p: 0.1,        // 极致采样限制
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
