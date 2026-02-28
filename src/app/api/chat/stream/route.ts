import { NextRequest, NextResponse } from 'next/server';

/**
 * @fileOverview 硅基流动 (SiliconFlow) 流式对话转发接口。
 * 升级模型 ID 为 deepseek-ai/DeepSeek-V3.2。
 */

export const maxDuration = 60; // 延长到60秒
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  
  try {
    const { documentContent, userQuery, rules, history } = await req.json();

    // 验证必填参数
    if (!documentContent) {
      return NextResponse.json(
        { error: '缺少文档内容 (documentContent)', code: 'MISSING_DOCUMENT' },
        { status: 400 }
      );
    }
    if (!userQuery) {
      return NextResponse.json(
        { error: '缺少用户问题 (userQuery)', code: 'MISSING_QUERY' },
        { status: 400 }
      );
    }

    const SILICON_FLOW_API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
    const SILICON_FLOW_API_KEY = process.env.SILICON_FLOW_API_KEY;
    const MODEL_ID = 'deepseek-ai/DeepSeek-V3.2';

    if (!SILICON_FLOW_API_KEY) {
      return NextResponse.json(
        { 
          error: '服务器配置错误：未设置 SILICON_FLOW_API_KEY 环境变量', 
          code: 'MISSING_API_KEY',
          hint: '请在 Vercel 项目设置中添加 SILICON_FLOW_API_KEY'
        },
        { status: 500 }
      );
    }

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
        stream: true
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.error?.message || errorData.message || 'API 请求失败';
      const statusCode = response.status;
      
      // 常见错误码及处理
      let hint = '';
      if (statusCode === 401) hint = 'API 密钥无效，请检查 SILICON_FLOW_API_KEY';
      if (statusCode === 403) hint = 'API 密钥权限不足';
      if (statusCode === 429) hint = 'API 调用频率超限，请稍后重试';
      if (statusCode >= 500) hint = '硅基流动服务暂时不可用';

      return NextResponse.json({ 
        error: `[DeepSeek V3.2] ${errorMsg}`, 
        code: `API_ERROR_${statusCode}`,
        hint,
        requestId
      }, { status: statusCode });
    }

    return new NextResponse(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error(`[${requestId}] Streaming Route Error:`, error);
    
    // 区分不同错误类型
    let errorMessage = error.message || '未知错误';
    let errorCode = 'UNKNOWN_ERROR';
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      errorMessage = '网络请求失败，请检查网络连接';
      errorCode = 'NETWORK_ERROR';
    }
    
    return NextResponse.json({ 
      error: errorMessage, 
      code: errorCode,
      requestId,
      hint: '如果问题持续存在，请刷新页面重试'
    }, { status: 500 });
  }
}
