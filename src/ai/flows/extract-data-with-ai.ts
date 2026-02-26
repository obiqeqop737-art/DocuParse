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
  prompt: `You are an expert technical document parser. Your task is to extract specific key information from the provided technical document based on the given extraction rules.

Document Content:
"""
{{{documentContent}}}
"""

Extraction Rules:
"""
{{{extractionRules}}}
"""

Carefully read the document content and identify the information specified in the extraction rules.
Output the extracted information as a JSON object, where the keys are the names of the fields to extract (as suggested by the extraction rules) and the values are the corresponding extracted data.
If a piece of information cannot be found, provide an empty string for its value.
Ensure the output is a valid JSON object.

Example Output Structure (based on rules like "Extract Document Title, Version, Author, Date of Issue"):
{
  "Document Title": "Example Technical Specification",
  "Version": "1.0",
  "Author": "John Doe",
  "Date of Issue": "2023-10-26"
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
      if (error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED') || error.message?.includes('quota')) {
        throw new Error('AI 服务当前配额已耗尽或请求过于频繁，请稍后再试。');
      }
      throw error;
    }
  }
);
