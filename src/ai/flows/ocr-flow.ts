'use server';
/**
 * @fileOverview 硅基流动 (SiliconFlow) 视觉 OCR 流程。
 * 用于处理扫描件 PDF，将其图片内容转换为 Markdown 文本。
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const OCRInputSchema = z.object({
  images: z.array(z.string()).describe('PDF 页面的 Base64 图片数据列表（带 MIME 类型）。'),
});
export type OCRInput = z.infer<typeof OCRInputSchema>;

const OCROutputSchema = z.object({
  fullText: z.string().describe('所有页面合并后的 Markdown 识别结果。'),
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
    // 严格使用用户要求的 Qwen/Qwen3-VL-32B-Instruct 模型
    const MODEL_ID = 'Qwen/Qwen3-VL-32B-Instruct'; 

    let combinedText = '';

    // 分页面处理以确保稳定性
    for (let i = 0; i < input.images.length; i++) {
      const base64Image = input.images[i];
      
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
                  { type: "text", text: "你是一个专业的工业文档识别专家。请将这张图片中的文字、表格和结构完整地提取出来，并转换为 Markdown 格式输出。不要包含任何解释性文字，直接输出文档内容。" },
                  { type: "image_url", image_url: { url: base64Image } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 4096
          }),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(`OCR API 错误: ${response.status} - ${error.message || '未知错误'}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        combinedText += `\n\n### 第 ${i + 1} 页识别结果 ###\n\n${content}`;
      } catch (error: any) {
        console.error(`Page ${i} OCR Failed:`, error);
        combinedText += `\n\n[第 ${i + 1} 页识别失败: ${error.message}]`;
      }
    }

    return { fullText: combinedText };
  }
);
