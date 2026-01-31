import { createLogger, LoggerConfig } from '@gratheon/log-lib';
import config from "../config/index";

const loggerConfig: LoggerConfig = {
  mysql: {
    host: config.mysql.host,
    port: Number(config.mysql.port),
    user: config.mysql.user,
    password: config.mysql.password,
    database: 'logs' // Using dedicated logs database
  }
};

const { logger, fastifyLogger } = createLogger(loggerConfig);

export { logger, fastifyLogger };
