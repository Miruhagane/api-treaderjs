import axios from "axios";
import { getLogger } from "../../config/logger";
const logger = getLogger('fxcmbridge');
const bridgeUrl = process.env.BRIDGE_URL || "http://localhost:5000";

export async function buyFxcm(epic: string, size: number, type: string) {

    try {

        const orderData = {
            symbol: epic,
            side: type.toUpperCase(),
            size: size,
            orderType: "MARKET"
        };

        const response = await axios.post(`${bridgeUrl}/fxcm/order`, orderData);
        return response.data;
    }
    catch (error) {
        logger.error({ err: error }, 'Error buying FXCM order');
        throw error;
    }

}

export async function closeFxcm(id: string) {

    try {
        const body = { tradeId: id };
        const response = await axios.post(`${bridgeUrl}/fxcm/close`, body, { headers: { 'Content-Type': 'application/json' } });
        return response.data;
    }
    catch (error) {
        logger.error({ err: error, tradeId: id }, 'Error closing FXCM order');
        throw error;
    }

}