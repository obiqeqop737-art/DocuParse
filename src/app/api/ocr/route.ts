import { NextRequest, NextResponse } from 'next/server';

/**
 * @fileOverview OCR 视觉识别 API
 */

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { images } = await req.json();

    if (!images || images.length === 0) {
      return NextResponse.json(
        { error: '没有要识别的图片' },
        { status: 400 }
      );
    }

    const SILICON_FLOW_API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
    const SILICON_FLOW_API_KEY = process.env.SILICON_FLOW_API_KEY;
    
    if (!SILICON_FLOW_API_KEY) {
      return NextResponse.json(
        { error: '未设置 SILICON_FLOW_API_KEY' },
        { status: 500 }
      );
    }

    // 使用 DeepSeek OCR 专用模型
    const MODEL_ID = 'deepseek-ai/DeepSeek-OCR';

    // 简化提示词
    const ocrPrompt = `请提取图片中的所有文字内容，以Markdown格式输出。`;

    // 逐个处理（减少并发避免超时）
    const results: { pageIndex: number; text: string }[] = [];

    for (const item of images) {
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
          const errorMsg = errorData.error?.message || 'OCR 失败';
          throw new Error(errorMsg);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        results.push({ pageIndex: item.pageIndex, text: content });
      } catch (error: any) {
        console.error(`Page ${item.pageIndex} OCR failed:`, error);
        results.push({ pageIndex: item.pageIndex, text: `[识别失败: ${error.message}]` });
      }
    }

    return NextResponse.json({ results });

  } catch (error: any) {
    console.error('OCR API Error:', error);
    return NextResponse.json(
      { error: error.message || 'OCR 处理失败' },
      { status: 500 }
    );
  }
}
