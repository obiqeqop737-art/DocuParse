import { NextRequest, NextResponse } from 'next/server';

/**
 * @fileOverview 文件解析 API - 轻量版
 * 使用 pdf-parse 进行文本提取，避免内存问题
 */

export const maxDuration = 60; // 1分钟

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const strategy = formData.get('strategy') as string || 'universal-expert';

    if (!file) {
      return NextResponse.json({ error: '没有上传文件' }, { status: 400 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    
    // 支持的文件类型
    const supportedTypes = ['pdf', 'docx', 'xlsx', 'xls', 'csv', 'txt'];
    if (!supportedTypes.includes(ext)) {
      return NextResponse.json({ error: `不支持的文件类型: ${ext}` }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let parsedContent = '';
    
    if (ext === 'pdf') {
      // PDF 文本提取
      parsedContent = await processPDF(buffer);
    } else if (['docx', 'doc'].includes(ext)) {
      parsedContent = await processDOCX(buffer);
    } else if (['xlsx', 'xls', 'csv'].includes(ext)) {
      parsedContent = await processExcel(buffer);
    } else if (ext === 'txt') {
      parsedContent = buffer.toString('utf-8');
    }

    if (!parsedContent.trim()) {
      return NextResponse.json({ error: '未能提取到有效内容' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      filename: file.name,
      content: parsedContent,
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

// ========== PDF 处理 (文本提取) ==========
async function processPDF(buffer: Buffer): Promise<string> {
  try {
    // 使用 pdf-parse 提取文本
    const pdfParse = await import('pdf-parse');
    const data = await pdfParse.default(buffer);
    return data.text || '';
  } catch (error: any) {
    console.error('PDF parse error:', error);
    // 如果文本提取失败，返回提示
    return `[PDF 文本提取失败，请确保 PDF 包含可搜索文本。如果是扫描版 PDF，建议先 OCR 处理。]`;
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
