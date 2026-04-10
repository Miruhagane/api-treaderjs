import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

const baseLogger = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    // Serializer for errors: prefer to expose `response.data` or `data` when present.
    serializers: {
        err: (err: any) => {
            try {
                const data = err?.response?.data ?? err?.data;
                if (data !== undefined) return { data };
                return { message: err?.message ?? String(err) };
            } catch (e) {
                return { message: String(err) };
            }
        }
    },
    transport: isDev
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'yyyy-mm-dd HH:MM:ss',
                levelFirst: true,
                ignore: 'pid,hostname',
                singleLine: false
            }
        }
        : undefined,
});

export type Bindings = { [key: string]: any };

export function getLogger(moduleName = 'app', bindings: Bindings = {}) {
    const child = baseLogger.child({ service: 'api-treaderjs', module: moduleName, ...bindings });
    // Return the child logger for the module. Do not silently mute modules by default.
    return child;
}

export default baseLogger;
