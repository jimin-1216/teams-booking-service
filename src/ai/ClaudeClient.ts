import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('ClaudeClient');

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!config.ai.apiKey) {
      throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
    }
    client = new Anthropic({ apiKey: config.ai.apiKey });
  }
  return client;
}

export interface ClaudeResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Claude API 호출 (JSON 모드)
 */
export async function callClaude(
  systemPrompt: string,
  userMessage: string,
): Promise<ClaudeResponse> {
  const anthropic = getClient();

  const startTime = Date.now();

  const response = await anthropic.messages.create({
    model: config.ai.model,
    max_tokens: config.ai.maxTokens,
    temperature: config.ai.temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const elapsed = Date.now() - startTime;
  const content = response.content[0].type === 'text' ? response.content[0].text : '';
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  logger.info('Claude API 호출', {
    model: config.ai.model,
    inputTokens,
    outputTokens,
    elapsedMs: elapsed,
  });

  return { content, inputTokens, outputTokens };
}
