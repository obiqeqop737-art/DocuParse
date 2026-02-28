'use server';
/**
 * @fileOverview TeleAI/TeleSpeechASR 语音转写流程。
 */

import { z } from 'genkit';

const ASRInputSchema = z.object({
  audioBase64: z.string().describe('Base64 编码的音频数据。'),
});
export type ASRInput = z.infer<typeof ASRInputSchema>;

const ASROutputSchema = z.object({
  text: z.string().describe('转写后的文本。'),
});
export type ASROutput = z.infer<typeof ASROutputSchema>;

export async function performASR(input: ASRInput): Promise<ASROutput> {
  const SILICON_FLOW_API_URL = 'https://api.siliconflow.cn/v1/audio/transcriptions';
  const SILICON_FLOW_API_KEY = process.env.SILICON_FLOW_API_KEY;
  const MODEL_ID = 'TeleAI/TeleSpeechASR';

  if (!SILICON_FLOW_API_KEY) {
    throw new Error('❌ 配置错误：未设置 SILICON_FLOW_API_KEY 环境变量\\n\\n💡 解决方案：在 Vercel 项目设置中添加该环境变量');
  }

  if (!input.audioBase64) {
    throw new Error('❌ 参数错误：没有音频数据');
  }

  try {
    // 提取 base64 数据
    const base64Data = input.audioBase64.includes(',') 
      ? input.audioBase64.split(',')[1] 
      : input.audioBase64;

    if (!base64Data) {
      throw new Error('❌ 音频数据格式错误');
    }

    console.log(`[ASR] 开始语音转写，使用模型: ${MODEL_ID}`);

    const formData = new FormData();
    const blob = new Blob([Buffer.from(base64Data, 'base64')], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');
    formData.append('model', MODEL_ID);

    const response = await fetch(SILICON_FLOW_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SILICON_FLOW_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.message || errorData.error?.message || '未知错误';
      
      if (response.status === 401) {
        throw new Error(`🔑 API 密钥无效 (401)\\n${errorMsg}`);
      } else if (response.status === 413) {
        throw new Error(`📁 音频文件过大 (413)\\n请上传小于 10MB 的音频`);
      } else if (response.status === 429) {
        throw new Error(`⏳ API 调用过于频繁 (429)\\n请稍后重试`);
      } else if (response.status >= 500) {
        throw new Error(`🔥 硅基流动服务错误 (${response.status})\\n${errorMsg}`);
      } else {
        throw new Error(`❌ 语音转写失败\\n错误: ${errorMsg}`);
      }
    }

    const data = await response.json();
    
    if (!data.text) {
      console.warn('[ASR] 音频转写结果为空');
      return { text: '[音频转写结果为空]' };
    }
    
    console.log(`[ASR] 转写完成`);
    return { text: data.text };
    
  } catch (error: any) {
    console.error('[ASR] 语音转写失败:', error);
    
    if (error.message.includes('Failed to fetch') || error.message.includes('network')) {
      throw new Error(`🌐 网络连接失败\\n请检查网络后重试`);
    }
    
    throw error;
  }
}
