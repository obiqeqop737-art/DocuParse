'use server';
/**
 * @fileOverview 硅基流动 (SiliconFlow) 文档对话 AI 流程。
 * 优化了 Token 消耗：文档内容仅在 System Prompt 中发送一次。
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
    // 硅基流动配置
    const SILICON_FLOW_API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
    const SILICON_FLOW_API_KEY = 'sk-orcwdodraxjcyrllecfaaukwuuepdysjqeeslnaarzhhjeey';
    // 更新为用户指定的最新型号
    const MODEL_ID = 'deepseek-ai/DeepSeek-V3';

    // 构造系统提示词：包含解析规则和文档内容
    const systemPrompt = `你是一个工厂技术文档专家。请严格遵循以下解析规则和文档背景来回答用户问题。

### 解析规则
${input.rules}

### 文档内容 (Markdown 格式)
${input.documentContent}

请注意：在后续对话中，我会保持对上述文档的记忆。如果用户提问与文档无关，请委婉告知。如果文档内容为空或解析失败，请提醒用户检查文件是否为图片扫描件。`;

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
        throw new Error(`硅基流动 API 错误 (${response.status}): ${errorData.message || '请检查模型 ID 是否正确'}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || 'AI 未能生成有效回答。';
      
      return { answer: content };
    } catch (error: any) {
      console.error('Chat Flow Error:', error);
      throw new Error(`对话失败: ${error.message}`);
    }
  }
);
