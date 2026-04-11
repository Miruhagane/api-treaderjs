import axios from "axios";
import { getLogger } from "../../config/logger";
const logger = getLogger('fxcmbridge');
const bridgeUrl = process.env.BRIDGE_URL || "http://localhost:5000";

export async function buyFxcm(epic: string, size: number | string, type: string) {

    try {
        const parsedSize = Number(size);
        if (Number.isNaN(parsedSize) || parsedSize <= 0) {
            const err = new Error(`Invalid size value for FXCM buy: ${size}`);
            logger.error({ err, epic, size }, 'Invalid size for FXCM buy');
            throw err;
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

        const body = { tradeId };
        const response = await axios.post(`${bridgeUrl}/fxcm/close`, body, { headers: { 'Content-Type': 'application/json' } });
        return response.data;
    }
    catch (error) {
        logger.error({ err: error, tradeId: id }, 'Error closing FXCM order');
        throw error;
    }

}