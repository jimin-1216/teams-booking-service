import OpenAI from 'openai';
import { config } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('LLMClient');

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    if (!config.ai.apiKey) {
      throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
    }
    client = new OpenAI({ apiKey: config.ai.apiKey });
  }
  return client;
}

export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * GPT API 호출 (JSON 모드)
 */
export async function callClaude(
  systemPrompt: string,
  userMessage: string,
): Promise<LLMResponse> {
  const openai = getClient();
  const startTime = Date.now();

  const response = await openai.chat.completions.create({
    model: config.ai.model,
    max_tokens: config.ai.maxTokens,
    temperature: config.ai.temperature,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  const elapsed = Date.now() - startTime;
  const content = response.choices[0]?.message?.content || '';
  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;

  logger.info('GPT API 호출', {
    model: config.ai.model,
    inputTokens,
    outputTokens,
    elapsedMs: elapsed,
  });

  return { content, inputTokens, outputTokens };
}
