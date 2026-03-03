import { createLogger, LoggerConfig } from '@gratheon/log-lib';
import config from "../config/index";

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
  const loggerConfig: LoggerConfig = {
    mysql: {
      host: config.mysql.host,
      port: Number(config.mysql.port),
      user: config.mysql.user,
      password: config.mysql.password,
      database: 'logs' // Using dedicated logs database
    }
  };

  const created = createLogger(loggerConfig);
  logger = created.logger;
  fastifyLogger = created.fastifyLogger;
}

export { logger, fastifyLogger };
