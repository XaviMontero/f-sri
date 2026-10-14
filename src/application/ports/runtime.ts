export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export type Sleeper = (ms: number) => Promise<void>;

export const realSleep: Sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info: (m, meta) => console.log(m, meta ?? ''),
  warn: (m, meta) => console.warn(m, meta ?? ''),
  error: (m, meta) => console.error(m, meta ?? ''),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
