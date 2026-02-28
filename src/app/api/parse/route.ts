import { NextRequest, NextResponse } from 'next/server';

/**
 * @fileOverview PDF 解析 API - 支持SSE进度推送
 */

export const maxDuration = 600; // 10分钟超时

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  
  // 创建流式响应
  const stream = new ReadableStream({
    async start(controller) {
      const sendProgress = (current: number, total: number, status: string) => {
        const data = JSON.stringify({ current, total, status });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      try {
        const formData = await req.formData();
        const file = formData.get('file') as File;
        
        if (!file) {
          sendProgress(0, 0, '错误: 没有文件');
          controller.enqueue(encoder.encode('data: [ERROR]\n\n'));
          controller.close();
          return;
        }

        const apiKey = process.env.SILICON_FLOW_API_KEY;
        
        if (!apiKey) {
          sendProgress(0, 0, '错误: 未配置API Key');
          controller.enqueue(encoder.encode('data: [ERROR]\n\n'));
          controller.close();
          return;
        }

        // 读取文件为 Buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        sendProgress(0, 100, '开始解析...');

        // 动态导入 parser（因为它有 top-level await）
        const { parsePDF } = await import('@/service/parser');
        
        const result = await parsePDF(buffer, {
          apiKey,
          onProgress: sendProgress,
        });

        // 发送完成结果
        const resultData = JSON.stringify({
          text: result.text,
          method: result.method,
          pages: result.pagesProcessed,
        });
        
        controller.enqueue(encoder.encode(`data: ${resultData}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        
      } catch (error: any) {
        console.error('[PDF解析API] 错误:', error);
        sendProgress(0, 0, `错误: ${error.message}`);
        controller.enqueue(encoder.encode('data: [ERROR]\n\n'));
      }
      
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
