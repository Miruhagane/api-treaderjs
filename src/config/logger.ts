import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

const baseLogger = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    // Use ISO timestamps so external log systems parse time reliably.
    timestamp: pino.stdTimeFunctions.isoTime,
    // Expose the textual level label in the JSON (e.g. "info", "error").
    formatters: {
        level(label: string) {
            return { level: label };
        }
    },
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
    // Keep human-friendly pretty printing only for development. In production
    // pino will emit compact single-line JSON to stdout, which Railway can
    // ingest and index reliably.
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
