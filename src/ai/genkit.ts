import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

export const ai = genkit({
  plugins: [googleAI()],
  // 切换到 Pro 模型以获得更精准的技术文档分析能力
  model: 'googleai/gemini-1.5-pro',
});
