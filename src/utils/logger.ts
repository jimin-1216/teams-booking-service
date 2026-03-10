import { config } from '../config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LOG_LEVELS[config.logLevel as LogLevel] ?? LOG_LEVELS.info;

// 민감정보 마스킹 패턴
const SENSITIVE_PATTERNS = [
  /password["\s:=]+["']?[^"'\s,}]+/gi,
  /token["\s:=]+["']?[^"'\s,}]+/gi,
  /MILE_USERNAME["\s:=]+["']?[^"'\s,}]+/gi,
  /MILE_PASSWORD["\s:=]+["']?[^"'\s,}]+/gi,
];

function maskSensitive(message: string): string {
  let masked = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      const eqIndex = match.search(/[=:]/);
      if (eqIndex === -1) return '***';
      return match.substring(0, eqIndex + 1) + '***';
    });
  }
  return masked;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  duration_ms?: number;
  [key: string]: unknown;
}

function log(level: LogLevel, module: string, message: string, extra?: Record<string, unknown>) {
  if (LOG_LEVELS[level] < currentLevel) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message: maskSensitive(message),
    ...extra,
  };

  const output = JSON.stringify(entry);

  switch (level) {
    case 'error':
      console.error(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    default:
      console.log(output);
  }
}

export function createLogger(module: string) {
  return {
    debug: (message: string, extra?: Record<string, unknown>) =>
      log('debug', module, message, extra),
    info: (message: string, extra?: Record<string, unknown>) =>
      log('info', module, message, extra),
    warn: (message: string, extra?: Record<string, unknown>) =>
      log('warn', module, message, extra),
    error: (message: string, extra?: Record<string, unknown>) =>
      log('error', module, message, extra),
  };
}
