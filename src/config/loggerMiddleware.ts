import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { getLogger } from './logger';

declare global {
    namespace Express {
        interface Request {
            logger?: ReturnType<typeof getLogger>;
            reqId?: string;
            log?: any;
        }
    }
}

export const loggerMiddleware = (req: Request, _res: Response, next: NextFunction) => {
    const reqId = randomBytes(6).toString('hex');
    req.reqId = reqId;
    const meta = { reqId, method: req.method, route: req.originalUrl };

    if ((req as any).log && typeof (req as any).log.child === 'function') {
        req.logger = (req as any).log.child({ reqId, module: 'http', service: 'api-treaderjs' });
    } else {
        req.logger = getLogger('http', meta);
    }

    req.logger.info({ req: { method: req.method, url: req.originalUrl } }, 'request_start');
    next();
};

export default loggerMiddleware;
