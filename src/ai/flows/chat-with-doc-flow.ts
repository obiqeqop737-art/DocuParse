
'use server';
/**
 * @fileOverview 文档对话 AI 流程。
 * 集成了“解析规则”作为系统背景提示词，支持多轮对话。
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const ChatWithDocInputSchema = z.object({
  documentContent: z.string().describe('文档全文内容。'),
  userQuery: z.string().describe('用户的问题。'),
  rules: z.string().describe('当前挂载的解析规则（系统提示词）。'),
  history: z.array(z.object({
    role: z.enum(['user', 'model']),
    content: z.string()
  })).optional().describe('对话历史记录。'),
});
export type ChatWithDocInput = z.infer<typeof ChatWithDocInputSchema>;

const ChatWithDocOutputSchema = z.object({
  answer: z.string().describe('AI 的回答内容。'),
});
export type ChatWithDocOutput = z.infer<typeof ChatWithDocOutputSchema>;

export async function chatWithDoc(input: ChatWithDocInput): Promise<ChatWithDocOutput> {
  return chatWithDocFlow(input);
}

const chatWithDocFlow = ai.defineFlow(
  {
    name: 'chatWithDocFlow',
    inputSchema: ChatWithDocInputSchema,
    outputSchema: ChatWithDocOutputSchema,
  },
  async (input) => {
    const CUSTOM_API_URL = process.env.CUSTOM_AI_API_URL || 'https://your-internal-api.com/v1/chat/completions';
    const CUSTOM_API_KEY = process.env.CUSTOM_AI_API_KEY || '';

    const messages = [
      { 
        role: "system", 
        content: `你是一个工厂技术文档专家。
请严格遵循以下解析规则来处理文档内容：
"""
${input.rules}
"""

文档内容如下：
"""
${input.documentContent}
"""` 
      },
      ...(input.history || []).map(h => ({ role: h.role === 'model' ? 'assistant' : 'user', content: h.content })),
      { role: "user", content: input.userQuery }
    ];

    try {
      const response = await fetch(CUSTOM_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CUSTOM_API_KEY}`,
        },
        body: JSON.stringify({
          model: "your-custom-model",
          messages: messages,
          temperature: 0.3, // 保持低随机性以确保技术准确性
        }),
      });

      if (!response.ok) throw new Error(`API 错误: ${response.status}`);
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || 'AI 未能生成回答。';
      
      return { answer: content };
    } catch (error: any) {
      console.error('Chat Flow Error:', error);
      throw new Error(`对话失败: ${error.message}`);
    }
  }
);
