import PQueue from 'p-queue';
import { config } from '../config';
import { createLogger } from './logger';

const logger = createLogger('queue');

// 인메모리 작업 큐 (동시 스크래핑 요청 순차 처리)
const scraperQueue = new PQueue({
  concurrency: config.scraper.maxBrowserInstances,
  timeout: config.scraper.queueTimeout,
  throwOnTimeout: true,
});

scraperQueue.on('active', () => {
  logger.debug('작업 시작', {
    pending: scraperQueue.pending,
    size: scraperQueue.size,
  });
});

scraperQueue.on('error', (error) => {
  logger.error('큐 작업 실패', { error: (error as Error).message });
});

export async function enqueueScraperTask<T>(
  task: () => Promise<T>,
  taskName: string,
): Promise<T> {
  if (scraperQueue.size >= config.scraper.maxQueueSize) {
    throw new Error('현재 요청이 많습니다. 잠시 후 다시 시도해주세요.');
  }

  logger.info(`큐에 작업 추가: ${taskName}`, {
    queueSize: scraperQueue.size,
    pending: scraperQueue.pending,
  });

  return scraperQueue.add(async () => {
    const start = Date.now();
    try {
      const result = await task();
      logger.info(`작업 완료: ${taskName}`, { duration_ms: Date.now() - start });
      return result;
    } catch (error) {
      logger.error(`작업 실패: ${taskName}`, {
        duration_ms: Date.now() - start,
        error: (error as Error).message,
      });
      throw error;
    }
  }) as Promise<T>;
}

export { scraperQueue };
