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
    throw new Error('Server configuration error: SILICON_FLOW_API_KEY not set');
  }

  try {
    // 提取 base64 数据
    const base64Data = input.audioBase64.includes(',') 
      ? input.audioBase64.split(',')[1] 
      : input.audioBase64;

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
      throw new Error(`ASR API 错误: ${errorData.message || '请求失败'}`);
    }

    const data = await response.json();
    return { text: data.text || '' };
  } catch (error: any) {
    console.error('ASR Flow Error:', error);
    throw new Error(`语音识别失败: ${error.message}`);
  }
}
