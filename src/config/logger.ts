import pino from 'pino';

const baseLogger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

export type Bindings = { [key: string]: any };

export function getLogger(moduleName = 'app', bindings: Bindings = {}) {
    return baseLogger.child({ service: 'api-treaderjs', module: moduleName, ...bindings });
}

export default baseLogger;
