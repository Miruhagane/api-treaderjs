import axios from "axios";
import { getLogger } from "../../config/logger";
const logger = getLogger('fxcmbridge');
const bridgeUrl = process.env.BRIDGE_URL || "http://localhost:5000";

// --- Health check cache ---
// Avoids an extra HTTP round-trip on every order.
// The bridge is considered healthy for HEALTH_TTL_MS after a successful check.
const HEALTH_TTL_MS = 30_000;
let lastHealthCheck = 0;
let lastHealthOk = false;

async function ensureBridgeHealthy(): Promise<void> {
    const now = Date.now();
    if (lastHealthOk && now - lastHealthCheck < HEALTH_TTL_MS) return;

    const healthResp = await axios.get(`${bridgeUrl}/fxcm/health`, { timeout: 3000 });
    const connected = healthResp?.data?.connected;
    lastHealthCheck = Date.now();
    lastHealthOk = !!connected;

    if (!connected) {
        lastHealthOk = false;
        const err = new Error(`FXCM bridge not connected`);
        logger.error({ err, health: healthResp?.data }, 'FXCM bridge unhealthy');
        throw err;
    }
}

export async function buyFxcm(epic: string, size: number | string, type: string) {

    try {
        const parsedSize = Number(size);
        if (Number.isNaN(parsedSize) || parsedSize <= 0) {
            const err = new Error(`Invalid size value for FXCM buy: ${size}`);
            logger.error({ err, epic, size }, 'Invalid size for FXCM buy');
            throw err;
        }

        try {
            await ensureBridgeHealthy();
        } catch (hErr) {
            logger.error({ err: hErr, epic }, 'Failed FXCM bridge health check');
            throw hErr;
        }

        const orderData = {
            symbol: epic,
            side: String(type).toUpperCase(),
            size: parsedSize,
            orderType: "MARKET"
        };

        const response = await axios.post(`${bridgeUrl}/fxcm/order`, orderData);
        return response.data;
    }
    catch (error) {
        logger.error({ err: error, epic, size }, 'Error buying FXCM order');
        throw error;
    }

}

export interface FxcmCloseResponse {
    success: boolean;
    confirmed: boolean;
    tradeId: string;
    requestId?: string;
    openPrice?: number;
    closePrice?: number;
    netPL?: number;
    amount?: number;
    status?: string;
    error?: string;
}

/**
 * Cierra una posición en FXCM con reintentos.
 *
 * El bridge puede responder en 4 modos:
 *  - success=true, confirmed=true  -> cierre confirmado en tabla ClosedTrades
 *  - success=true, confirmed=false -> aceptado por servidor pero sin confirmar en tabla
 *                                     (el cliente decide si reintentar)
 *  - success=false, status=rejected -> el servidor FXCM rechazó la orden
 *  - success=false, status=timeout  -> no hubo respuesta en 20s
 *
 * Esta función sólo resuelve cuando confirmed=true. En caso contrario,
 * reintenta hasta `maxRetries` veces con backoff exponencial.
 */
export async function closeFxcm(
    id: string | number,
    options: { maxRetries?: number; backoffMs?: number } = {}
): Promise<FxcmCloseResponse> {

    const { maxRetries = 3, backoffMs = 1000 } = options;

    const tradeIdRaw = String(id);
    const tradeIdNum = Number(id);
    if (Number.isNaN(tradeIdNum)) {
        const err = new Error(`Invalid tradeId for FXCM close: ${id}`);
        logger.error({ err, tradeId: id }, 'Invalid tradeId for FXCM close');
        throw err;
    }

    let lastError: Error | null = null;
    let lastResponse: FxcmCloseResponse | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const body = { tradeId: tradeIdRaw };
            const response = await axios.post(`${bridgeUrl}/fxcm/close`, body, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });
            const data = response.data as FxcmCloseResponse;
            lastResponse = data;

            logger.info(
                { tradeId: tradeIdRaw, attempt, confirmed: data.confirmed, success: data.success, status: data.status, error: data.error },
                'FXCM close response'
            );

            // Camino feliz: cierre confirmado por el servidor y la tabla.
            if (data.success && data.confirmed) {
                return data;
            }

            // El servidor rechazó la orden. No tiene sentido reintentar
            // inmediatamente; propagamos el error.
            if (data.success === false && (data.status === 'rejected' || data.status === 'timeout')) {
                const err = new Error(
                    `FXCM close rejected (tradeId=${tradeIdRaw}, status=${data.status}): ${data.error ?? 'sin mensaje'}`
                );
                logger.error({ err, data, attempt }, 'FXCM close rejected by server');
                throw err;
            }

            // Aceptado por servidor pero no confirmado en tabla aún.
            // Reintentamos tras un backoff.
            logger.warn(
                { tradeId: tradeIdRaw, attempt, data },
                'FXCM close accepted but not confirmed in table, retrying'
            );
            lastError = new Error(`Close accepted but not confirmed (status=${data.status})`);

            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, backoffMs * attempt));
            }
        }
        catch (error: any) {
            // Si el bridge devolvió un 400 con info, intentar leer el body
            if (error?.response?.data) {
                const data = error.response.data as FxcmCloseResponse;
                lastResponse = data;
                logger.warn(
                    { tradeId: tradeIdRaw, attempt, data },
                    'FXCM close returned error response'
                );

                // Si fue rejected o timeout, no reintentamos
                if (data.status === 'rejected' || data.status === 'timeout') {
                    const err = new Error(
                        `FXCM close ${data.status} (tradeId=${tradeIdRaw}): ${data.error ?? 'sin mensaje'}`
                    );
                    logger.error({ err, data, attempt }, 'FXCM close non-retryable failure');
                    throw err;
                }
            }

            lastError = error instanceof Error ? error : new Error(String(error));
            logger.warn(
                { err: lastError, tradeId: tradeIdRaw, attempt },
                'FXCM close attempt failed, will retry'
            );

            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, backoffMs * attempt));
            }
        }
    }

    // Agotamos los reintentos
    const err = new Error(
        `FXCM close falló tras ${maxRetries} intentos (tradeId=${tradeIdRaw}): ${lastError?.message ?? 'sin detalle'}`
    );
    logger.error({ err, lastResponse, tradeId: tradeIdRaw }, 'FXCM close exhausted retries');
    throw err;
}
