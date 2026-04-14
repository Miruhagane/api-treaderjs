import { Request, Response, NextFunction } from 'express';
import baseLogger from './logger';

export const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    // Usamos el ID de petición si existe para trazar el error
    const reqId = req.reqId || 'unknown';

    // Logueamos el error de forma estructurada
    baseLogger.error({
        reqId,
        msg: err.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : err.stack, // Ocultar stack en producción
        method: req.method,
        url: req.originalUrl,
        err: err // El serializador de tu logger.ts extraerá la data relevante
    }, 'request_error');

    // Respuesta estandarizada al cliente
    res.status(err.status || 500).json({
        success: false,
        reqId,
        error: {
            type: err.name || 'InternalError',
            message: err.message || 'Ocurrió un error inesperado en el servidor'
        }
    });
};