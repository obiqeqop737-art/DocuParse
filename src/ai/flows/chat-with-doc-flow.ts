'use server';
/**
 * @fileOverview 文档对话 AI 流程。
 * 使用自定义 API 接口处理基于文档内容的问答。
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const ChatWithDocInputSchema = z.object({
  documentContent: z.string().describe('文档全文内容。'),
  userQuery: z.string().describe('用户的问题。'),
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
        content: `你是一个专业的技术文档助手。请根据以下文档内容回答用户的问题。如果文档中没有相关信息，请诚实回答。
文档内容：
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
          temperature: 0.7,
        }),
      });

      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || 'AI 未能生成回答。';
      
      return { answer: content };
    } catch (error: any) {
      console.error('Chat Flow Error:', error);
      throw new Error(`对话失败: ${error.message}`);
    }
  }
);
