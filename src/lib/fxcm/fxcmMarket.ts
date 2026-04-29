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

export async function closeFxcm(id: string | number) {

    try {
        const tradeId = Number(id);
        if (Number.isNaN(tradeId)) {
            const err = new Error(`Invalid tradeId for FXCM close: ${id}`);
            logger.error({ err, tradeId: id }, 'Invalid tradeId for FXCM close');
            throw err;
        }

        const body = { tradeId: String(id) };
        const response = await axios.post(`${bridgeUrl}/fxcm/close`, body, { headers: { 'Content-Type': 'application/json' } });
        return response.data;
    }
    catch (error) {
        logger.error({ err: error, tradeId: id }, 'Error closing FXCM order');
        throw error;
    }

}