import { z, ZodSchema } from 'zod';
import { Request, Response, NextFunction } from 'express';

// ─── Schemas compartidos ─────────────────────────────────────────────────────

const epicBinance = z.string().min(1, 'epic es requerido').max(20).regex(/^[A-Z0-9]+$/, 'epic debe ser un símbolo válido (ej. BTCUSDT)');
const epicFxcm = z.string().min(1, 'epic es requerido').max(20);
const side = z.enum(['BUY', 'SELL'], { message: "type debe ser 'BUY' o 'SELL'" });
const strategy = z.string().min(1, 'strategy es requerido').max(50);
const sizeBinance = z.number().positive('size debe ser un número positivo');
const sizeFxcm = z.number().int('size debe ser un número entero').positive('size debe ser positivo');
const leverage = z.number().int('leverage debe ser entero').positive('leverage debe ser positivo').max(125, 'leverage máximo 125x').optional();
const marketBinance = z.enum(['SPOT', 'FUTURE'], { message: "market debe ser 'SPOT' o 'FUTURE'" }).optional();
const marketFxcm = z.enum(['FUTURE'], { message: "market debe ser 'FUTURE'" }).optional();

// ─── Schemas por endpoint ────────────────────────────────────────────────────

export const binanceBuySchema = z.object({
  epic: epicBinance,
  size: sizeBinance,
  type: side,
  strategy: strategy.optional(),
  market: marketBinance,
  leverage: leverage,
});

export const binanceSellSchema = z.object({
  epic: epicBinance.optional(),
  size: sizeBinance.optional(),
  type: side,
  market: z.enum(['SPOT', 'FUTURE'], { message: "market debe ser 'SPOT' o 'FUTURE'" }),
  strategy: strategy,
  leverage: leverage,
});

export const binanceContinuousSchema = z.object({
  epic: epicBinance,
  size: sizeBinance,
  type: side,
  strategy: strategy,
  market: z.enum(['SPOT', 'FUTURE'], { message: "market debe ser 'SPOT' o 'FUTURE'" }),
  leverage: leverage,
});

export const fxcmBuySchema = z.object({
  epic: epicFxcm,
  size: sizeFxcm,
  type: side,
  strategy: strategy.optional(),
});

export const fxcmContinuousSchema = z.object({
  epic: epicFxcm,
  size: sizeFxcm,
  type: side,
  strategy: strategy,
  market: marketFxcm,
});

// ─── Tipos inferidos ─────────────────────────────────────────────────────────

export type BinanceBuyInput = z.infer<typeof binanceBuySchema>;
export type BinanceSellInput = z.infer<typeof binanceSellSchema>;
export type BinanceContinuousInput = z.infer<typeof binanceContinuousSchema>;
export type FxcmBuyInput = z.infer<typeof fxcmBuySchema>;
export type FxcmContinuousInput = z.infer<typeof fxcmContinuousSchema>;

// ─── Middleware de validación ────────────────────────────────────────────────

export const validate = (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        errors: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req.body = result.data;
    next();
  };
