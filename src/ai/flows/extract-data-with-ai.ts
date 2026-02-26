'use server';
/**
 * @fileOverview 自定义 AI 数据提取流程。
 * 
 * 已剥离 Google AI 插件，改为调用自定义/内部 AI 接口。
 * 这样可以确保数据在受控的私有化网络或自定义 API 中处理。
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// 定义输入和输出 Schema
const ExtractDataWithAIInputSchema = z.object({
  documentContent: z.string().describe('需要解析的技术文档内容。'),
  extractionRules: z.string().describe('数据提取规则。'),
});
export type ExtractDataWithAIInput = z.infer<typeof ExtractDataWithAIInputSchema>;

const ExtractDataWithAIOutputSchema = z.record(z.string(), z.string()).describe('提取结果 JSON。');
export type ExtractDataWithAIOutput = z.infer<typeof ExtractDataWithAIOutputSchema>;

/**
 * 调用自定义 AI API 的包装函数
 */
export async function extractDataWithAI(input: ExtractDataWithAIInput): Promise<ExtractDataWithAIOutput> {
  return extractDataWithAIFlow(input);
}

/**
 * 使用 Genkit 定义流程，但内部逻辑改为 fetch 请求自定义 API
 */
const extractDataWithAIFlow = ai.defineFlow(
  {
    name: 'extractDataWithAIFlow',
    inputSchema: ExtractDataWithAIInputSchema,
    outputSchema: ExtractDataWithAIOutputSchema,
  },
  async (input) => {
    // 这里是你自定义 API 的配置
    // 建议通过环境变量管理敏感信息
    const CUSTOM_API_URL = process.env.CUSTOM_AI_API_URL || 'https://your-internal-api.com/v1/chat/completions';
    const CUSTOM_API_KEY = process.env.CUSTOM_AI_API_KEY || '';

    const systemPrompt = `你是一位专业的技术文档解析专家。请从文档中提取关键信息并返回 JSON 格式。
文档内容：
"""
${input.documentContent}
"""
提取规则：
"""
${input.extractionRules}
"""`;

    try {
      const response = await fetch(CUSTOM_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CUSTOM_API_KEY}`,
        },
        body: JSON.stringify({
          model: "your-custom-model", // 指定你的模型名称
          messages: [
            { role: "system", content: "你是一个精准的数据提取助手。" },
            { role: "user", content: systemPrompt }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" } // 如果你的 API 支持 JSON 模式
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API 请求失败 (${response.status}): ${errorData.message || '未知错误'}`);
      }

      const data = await response.json();
      
      // 假设你的 API 返回格式类似 OpenAI: data.choices[0].message.content
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) {
        throw new Error('AI 服务未返回内容。');
      }

      // 尝试解析 AI 返回的 JSON 字符串
      try {
        return JSON.parse(content);
      } catch {
        // 如果不是标准 JSON，尝试清理（处理 Markdown 代码块等）
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
        throw new Error('AI 返回的内容无法解析为 JSON。');
      }

    } catch (error: any) {
      console.error('AI 流程错误:', error);
      throw new Error(`数据提取失败: ${error.message}`);
    }
  }
);
