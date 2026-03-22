import { createLogger } from '@gratheon/log-lib';

const isJest = process.env.NODE_ENV === 'test';
const noop = () => undefined;

let logger: {
  info: (...args: any[]) => void;
  debug: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  errorEnriched: (...args: any[]) => void;
};

let fastifyLogger: any;

if (isJest) {
  logger = {
    info: noop,
    debug: noop,
    warn: noop,
    error: noop,
    errorEnriched: noop,
  };
  fastifyLogger = false;
} else {
  const created = createLogger();
  logger = created.logger;
  fastifyLogger = created.fastifyLogger;
}

export { logger, fastifyLogger };
