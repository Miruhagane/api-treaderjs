import axios from 'axios';
import crypto from 'crypto';

const API_KEY = process.env.Binance_ApiKey;
const API_SECRET = process.env.Binance_ApiSecret;
const BASE = 'https://demo-api.binance.com/api';

function sign(qs) {
    return crypto.createHmac('sha256', API_SECRET).update(qs).digest('hex');
}

export async function marketBuy(symbol: string, quoteOrderQty: number) {

    const params = new URLSearchParams({
        symbol,
        side: "BUY",
        type: "MARKET",
        quoteOrderQty: '6', // cantidad en base asset (ej. "0.001")
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
        return res.data;
    }
    catch (error) {
        console.error('Error en marketBuy:', error.response ? error.response.data : error.message);
        throw error;
    }

}