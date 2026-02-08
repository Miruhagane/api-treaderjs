import axios from 'axios';
import crypto from 'crypto';

const API_KEY = process.env.Binance_ApiKey;
const API_SECRET = process.env.Binance_ApiSecret;
const BASE = 'https://demo-api.binance.com/api';

function sign(qs) {
    return crypto.createHmac('sha256', API_SECRET).update(qs).digest('hex');
}

export async function binanceMarket(symbol: string, quoteOrderQty: number, type: string) {

    const params = new URLSearchParams({
        symbol,
        side: type,
        type: "MARKET",
        quoteOrderQty: quoteOrderQty.toString(), // cantidad en base asset (ej. "0.001")
        timestamp: Date.now().toString(),
        recvWindow: "5000",
    });

    const signature = sign(params.toString());
    params.append('signature', signature);
    try {
        const res = await axios.post(`${BASE}/v3/order`, params.toString(), {
            headers: {
                'X-MBX-APIKEY': API_KEY,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 5000
        });


        return await getOrderInformation(symbol, res.data.orderId);
    }
    catch (error) {
        console.error('Error en marketBuy:', error.response ? error.response.data : error.message);
        throw error;
    }

}

async function getOrderInformation(symbol: string, orderId: number) {

    const params = new URLSearchParams({
        symbol,
        timestamp: Date.now().toString(),
    });


    const signature = sign(params.toString());
    params.append('signature', signature);

    try {
        const res = await axios.get(`${BASE}/v3/myTrades?${params.toString()}`, {
            headers: {
                'X-MBX-APIKEY': API_KEY,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 5000
        });

        return res.data.filter((t: any) => t.orderId === orderId)[0];
    }
    catch (error) {
        console.error('Error en getOrderInformation:', error.response ? error.response.data : error.message);
        throw error;
    }

}