import { NextRequest, NextResponse } from 'next/server';

/**
 * @fileOverview 文件解析 API - 轻量版
 * PDF 文本提取 + 前端 OCR 支持
 */

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const strategy = formData.get('strategy') as string || 'universal-expert';

    if (!file) {
      return NextResponse.json({ error: '没有上传文件' }, { status: 400 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    
    const supportedTypes = ['pdf', 'docx', 'xlsx', 'xls', 'csv', 'txt'];
    if (!supportedTypes.includes(ext)) {
      return NextResponse.json({ error: `不支持的文件类型: ${ext}` }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let parsedContent = '';
    let needsOCR = false;
    
    if (ext === 'pdf') {
      const result = await processPDF(buffer);
      parsedContent = result.content;
      needsOCR = result.needsOCR;
    } else if (['docx', 'doc'].includes(ext)) {
      parsedContent = await processDOCX(buffer);
    } else if (['xlsx', 'xls', 'csv'].includes(ext)) {
      parsedContent = await processExcel(buffer);
    } else if (ext === 'txt') {
      parsedContent = buffer.toString('utf-8');
    }

    if (!parsedContent.trim() && !needsOCR) {
      return NextResponse.json({ error: '未能提取到有效内容' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      filename: file.name,
      content: parsedContent,
      needsOCR,
      strategy
    });

  } catch (error: any) {
    console.error('Parse API Error:', error);
    return NextResponse.json(
      { error: error.message || '解析失败' },
      { status: 500 }
    );
  }
}

// ========== PDF 处理 ==========
async function processPDF(buffer: Buffer): Promise<{ content: string; needsOCR: boolean }> {
  try {
    const pdfParse = await import('pdf-parse');
    const data = await pdfParse.default(buffer);
    
    // 如果提取到足够的文本，直接返回
    if (data.text && data.text.trim().length > 100) {
      console.log('[PDF] 文本提取成功');
      return { content: data.text, needsOCR: false };
    }
    
    console.log('[PDF] 文本提取失败或内容过少，需要 OCR');
    return { content: '', needsOCR: true };
    
  } catch (error: any) {
    console.error('PDF parse error:', error);
    return { content: '', needsOCR: true };
  }
}

// ========== DOCX 处理 ==========
async function processDOCX(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

// ========== Excel 处理 ==========
async function processExcel(buffer: Buffer): Promise<string> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  return workbook.SheetNames.map(name => 
    XLSX.utils.sheet_to_txt(workbook.Sheets[name])
  ).join('\n\n');
}
