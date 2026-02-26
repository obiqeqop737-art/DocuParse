
import { NextRequest, NextResponse } from 'next/server';

/**
 * @fileOverview 硅基流动 (SiliconFlow) 流式对话转发接口。
 * 允许前端通过 ReadableStream 实时获取 AI 的回答。
 */

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const { documentContent, userQuery, rules, history } = await req.json();

    const SILICON_FLOW_API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
    const SILICON_FLOW_API_KEY = 'sk-orcwdodraxjcyrllecfaaukwuuepdysjqeeslnaarzhhjeey';
    const MODEL_ID = 'deepseek-ai/DeepSeek-V3';

    const systemPrompt = `你是一个工厂技术文档专家。请严格遵循以下解析规则和文档背景来回答用户问题。

### 解析规则
${rules}

### 文档内容 (Markdown 格式)
${documentContent}

请注意：在后续对话中，我会保持对上述文档的记忆。如果用户提问与文档无关，请委婉告知。`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(history || []).map((h: any) => ({ 
        role: h.role === 'model' ? 'assistant' : 'user', 
        content: h.content 
      })),
      { role: "user", content: userQuery }
    ];

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
        stream: true // 开启流式传输
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json({ error: errorData.error?.message || 'API 请求失败' }, { status: response.status });
    }

    // 返回原始流给前端
    return new NextResponse(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error('Streaming Route Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
