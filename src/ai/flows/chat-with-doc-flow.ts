
'use server';
/**
 * @fileOverview 硅基流动 (SiliconFlow) 文档对话 AI 流程。
 * 优化了错误上报：将 API 报错详情完整传回前端。
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
    const SILICON_FLOW_API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
    const SILICON_FLOW_API_KEY = 'sk-orcwdodraxjcyrllecfaaukwuuepdysjqeeslnaarzhhjeey';
    // 严格按照用户要求使用 deepseek-ai/DeepSeek-V3.2
    const MODEL_ID = 'deepseek-ai/DeepSeek-V3.2';

    const systemPrompt = `你是一个工厂技术文档专家。请严格遵循以下解析规则和文档背景来回答用户问题。

### 解析规则
${input.rules}

### 文档内容 (Markdown 格式)
${input.documentContent}

请注意：在后续对话中，我会保持对上述文档的记忆。如果用户提问与文档无关，请委婉告知。`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(input.history || []).map(h => ({ 
        role: h.role === 'model' ? 'assistant' : 'user', 
        content: h.content 
      })),
      { role: "user", content: input.userQuery }
    ];

    try {
      const response = await fetch(SILICON_FLOW_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SILICON_FLOW_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL_ID,
          messages: messages,
          temperature: 0.3,
          max_tokens: 4096,
          stream: false
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || errorData.message || '未知服务器错误';
        throw new Error(`[语义模型 ID: ${MODEL_ID}] 错误: ${errorMsg}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || 'AI 未能生成有效回答。';
      
      return { answer: content };
    } catch (error: any) {
      console.error('Chat Flow Error:', error);
      throw new Error(`发送失败: ${error.message}`);
    }
  }
);
