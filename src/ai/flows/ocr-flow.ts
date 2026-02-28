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
  
  // 使用 Qwen2-VL 视觉模型
  const MODEL_ID = 'Qwen/Qwen2-VL-72B-Instruct';

  if (!SILICON_FLOW_API_KEY) {
    throw new Error('❌ 配置错误：未设置 SILICON_FLOW_API_KEY 环境变量\\n\\n💡 解决方案：在 Vercel 项目设置中添加该环境变量');
  }

  if (!input.images || input.images.length === 0) {
    throw new Error('❌ 参数错误：没有要识别的图片');
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

  console.log(`[OCR] 开始识别 ${input.images.length} 页图片，使用模型: ${MODEL_ID}`);

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
        const errorMsg = errorData.error?.message || errorData.message || '未知错误';
        
        if (response.status === 401) {
          throw new Error(`🔑 API 密钥无效 (401)\\n${errorMsg}`);
        } else if (response.status === 429) {
          throw new Error(`⏳ API 调用过于频繁 (429)\\n请稍后重试`);
        } else if (response.status >= 500) {
          throw new Error(`🔥 硅基流动服务错误 (${response.status})\\n${errorMsg}`);
        } else {
          throw new Error(`❌ OCR 识别失败\\n错误: ${errorMsg}`);
        }
      }

      const data = await response.json();
      
      if (!data.choices || !data.choices[0]?.message?.content) {
        throw new Error(`⚠️ OCR 响应格式异常\\n模型返回了空结果`);
      }
      
      const content = data.choices[0].message.content;
      results.push({ pageIndex: item.pageIndex, text: content });
      console.log(`[OCR] 第 ${item.pageIndex} 页识别完成`);
      
    } catch (error: any) {
      console.error(`[OCR] 第 ${item.pageIndex} 页识别失败:`, error);
      
      // 区分客户端错误和服务端错误
      if (error.message.includes('Failed to fetch') || error.message.includes('network')) {
        throw new Error(`🌐 网络连接失败\\n请检查网络后重试`);
      }
      throw error;
    }
  }

  console.log(`[OCR] 全部识别完成，共 ${results.length} 页`);
  return { results };
}
