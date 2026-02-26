'use server';
/**
 * @fileOverview 一个用于智能解析技术文档并根据预定义规则提取关键信息的 Genkit 流程。
 *
 * - extractDataWithAI - 处理 AI 数据提取过程的函数。
 * - ExtractDataWithAIInput - extractDataWithAI 函数的输入类型。
 * - ExtractDataWithAIOutput - extractDataWithAI 函数的返回类型。
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const ExtractDataWithAIInputSchema = z.object({
  documentContent: z.string().describe('需要解析的技术文档全文内容。'),
  extractionRules: z.string().describe('对需要提取的关键信息的自然语言描述。例如："提取文档标题、版本号、作者和发布日期。"'),
});
export type ExtractDataWithAIInput = z.infer<typeof ExtractDataWithAIInputSchema>;

const ExtractDataWithAIOutputSchema = z.record(z.string(), z.string()).describe('包含从文档中提取的键值对的 JSON 对象。键是字段名，值是对应的提取数据。');
export type ExtractDataWithAIOutput = z.infer<typeof ExtractDataWithAIOutputSchema>;

export async function extractDataWithAI(input: ExtractDataWithAIInput): Promise<ExtractDataWithAIOutput> {
  return extractDataWithAIFlow(input);
}

const extractDataPrompt = ai.definePrompt({
  name: 'extractDataPrompt',
  input: { schema: ExtractDataWithAIInputSchema },
  output: { schema: ExtractDataWithAIOutputSchema },
  prompt: `你是一位专业的技术文档解析专家。你的任务是从提供的技术文档内容中，根据给定的提取规则精确提取关键信息。

文档内容：
"""
{{{documentContent}}}
"""

提取规则：
"""
{{{extractionRules}}}
"""

请仔细阅读文档内容并识别提取规则中指定的各项信息。
输出要求：
1. 以 JSON 对象的形式输出，其中键是提取规则建议的字段名，值是对应的提取数据。
2. 如果在文档中找不到某项信息，请为该字段提供空字符串 ""。
3. 确保输出是合法的 JSON 对象。
4. 优先保留文档中的专业术语和数值精度。

示例输出结构（基于“提取文档标题、版本、作者、日期”规则）：
{
  "文档标题": "示例技术规范",
  "版本": "1.0",
  "作者": "张三",
  "发布日期": "2023-10-26"
}
`,
});

const extractDataWithAIFlow = ai.defineFlow(
  {
    name: 'extractDataWithAIFlow',
    inputSchema: ExtractDataWithAIInputSchema,
    outputSchema: ExtractDataWithAIOutputSchema,
  },
  async (input) => {
    try {
      const { output } = await extractDataPrompt(input);
      if (!output) {
        throw new Error('AI 未能生成有效的提取结果。');
      }
      return output;
    } catch (error: any) {
      // 捕获配额限制错误 (429) 并返回友好的中文提示
      if (error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED') || error.message?.includes('quota')) {
        throw new Error('AI 服务当前配额已耗尽或请求过于频繁，请稍后再试。');
      }
      throw error;
    }
  }
);
