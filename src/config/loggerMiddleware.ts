import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { getLogger } from './logger';
import baseLogger from './logger';

export const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    // Intentamos usar el logger de la petición (que ya tiene el reqId)
    // Si no existe (porque el error ocurrió antes del middleware), usamos el baseLogger
    const logger = req.logger || baseLogger;
    const reqId = req.reqId || 'unknown';

    logger.error({
        err, // El serializador de logger.ts extraerá la data de Axios/FXCM
        method: req.method,
        url: req.originalUrl,
        // No es necesario pasar stack manualmente si el serializador ya lo maneja,
        // pero puedes mantener la lógica de NODE_ENV si prefieres control total.
        stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
    }, 'request_error');

    res.status(err.status || 500).json({
        success: false,
        reqId,
        error: {
            type: err.name || 'InternalError',
            message: err.message || 'Ocurrió un error inesperado en el servidor'
        }
    });
};


export const loggerMiddleware = (req: Request, _res: Response, next: NextFunction) => {
    const reqId = randomBytes(6).toString('hex');
    req.reqId = reqId;
    const meta = { reqId, method: req.method, route: req.originalUrl };

    req.logger = getLogger('http', meta);
    req.logger.info({ req: { method: req.method, url: req.originalUrl } }, 'request_start');
    next();
};