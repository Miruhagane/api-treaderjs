import axios from 'axios';
import { getLogger } from '../../config/logger';
const log = getLogger('market');
import crypto from 'crypto';

const API_KEY = process.env.Binance_ApiKey;
const API_SECRET = process.env.Binance_ApiSecret;
const BASE = 'https://demo-api.binance.com/api';

const exchangeInfoCache: Map<string, any> = new Map();

let timeOffset = 0; // serverTime - localTime (ms)
let offsetUpdatedAt = 0; // timestamp cuando se actualizó el offset
const OFFSET_TTL = 60_000; // tiempo de validez del offset en ms (60s)
const DEFAULT_RECV_WINDOW = '60000';

async function syncServerTime(): Promise<number> {
    // Obtiene serverTime de Binance y actualiza timeOffset
    const res = await axios.get(`${BASE}/v3/time`, { timeout: 3000 });
    const serverTime: number = res.data && res.data.serverTime;
    timeOffset = serverTime - Date.now();
    offsetUpdatedAt = Date.now();
    return timeOffset;
}

function getAdjustedTimestamp(): string {
    // Si el offset no está inicializado o está caducado, quien llame debe invocar syncServerTime()
    return String(Date.now() + timeOffset);
}

async function callMyTrades(params: URLSearchParams) {
    const signature = sign(params.toString());
    params.append('signature', signature);

    const url = `${BASE}/v3/myTrades?${params.toString()}`;
    return axios.get(url, {
        headers: {
            'X-MBX-APIKEY': API_KEY,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 5000,
    });
}


function countDecimals(str: string) {
    const parts = (str || '').split('.');
    return parts[1] ? parts[1].length : 0;
}

async function getLotSizeFilter(symbol: string) {
    const key = symbol.toUpperCase();
    if (exchangeInfoCache.has(key)) return exchangeInfoCache.get(key);
    try {
        const res = await axios.get(`${BASE}/v3/exchangeInfo?symbol=${key}`);
        const sym = res.data.symbols && res.data.symbols[0];
        if (!sym) throw new Error('Symbol not found in exchangeInfo');
        const lot = sym.filters.find((f: any) => f.filterType === 'LOT_SIZE');
        if (!lot) throw new Error('LOT_SIZE filter not found');
        const info = {
            stepSize: lot.stepSize,
            minQty: lot.minQty,
            maxQty: lot.maxQty,
            precision: countDecimals(lot.stepSize)
        };
        exchangeInfoCache.set(key, info);
        return info;
    }
    catch (err) {
        log.warn({ err: err.message || err }, 'No se pudo obtener exchangeInfo; usando qty sin normalizar');
        return null;
    }
}

function normalizeQty(qty: number, stepSize: string, minQty?: string) {
    const precision = countDecimals(stepSize);
    const mult = Math.pow(10, precision);
    const adjusted = Math.floor(qty * mult) / mult;
    const adjustedSafe = Number(adjusted.toFixed(precision));
    const min = minQty ? Number(Number(minQty).toFixed(precision)) : 0;
    return adjustedSafe < min ? min : adjustedSafe;
}

function sign(qs) {
    return crypto.createHmac('sha256', API_SECRET).update(qs).digest('hex');
}

export async function binanceMarket(symbol: string, quoteOrderQty: number, type: string) {

    // normalizar cantidad según LOT_SIZE
    try {
        const lot = await getLotSizeFilter(symbol);
        if (lot) {
            const norm = normalizeQty(quoteOrderQty, lot.stepSize, lot.minQty);
            quoteOrderQty = norm;
        }
    }
    catch (e) {
        log.warn({ err: e.message || e }, 'Error normalizando qty');
    }

    const serverResp = await axios.get('https://api.binance.com/api/v3/time', { timeout: 5000 });
    const serverTime = serverResp.data.serverTime; // ms
    const localTime = Date.now();
    const offset = serverTime - localTime;

    const recvWindow = 60000;
    const timestamp = Date.now() + offset;

    let a = quoteOrderQty.toFixed(5);
    const params = new URLSearchParams({
        symbol,
        side: type,
        type: "MARKET",
        quantity: a.toString(),// cantidad en base asset (ej. "0.001")
        timestamp: timestamp.toString(),
        recvWindow: recvWindow.toString(),
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
        log.error({ err: error, body: error.response ? error.response.data : error.message }, 'Error en marketBuy');
        throw error;
    }

}

export async function getOrderInformation(symbol: string, orderId: number) {
    // Si el offset es viejo, intenta sincronizar antes de construir la petición
    if (Date.now() - offsetUpdatedAt > OFFSET_TTL) {
        try {
            await syncServerTime();
        } catch (err) {
            // Si falla la sincronización, no abortes; seguiremos con offset 0 (pero lo registramos).
            console.warn('No se pudo sincronizar el tiempo con Binance, se continuará con el offset actual:', err?.message || err);
        }
    }

    // Construye params iniciales
    const params = new URLSearchParams({
        symbol,
        timestamp: getAdjustedTimestamp(),
        recvWindow: DEFAULT_RECV_WINDOW, // opcional; ajustar según necesidad
    });

    try {
        const res = await callMyTrades(params);
        return res.data.filter((t: any) => t.orderId === orderId)[0];
    } catch (error: any) {
        const respData = error?.response?.data;
        const code = respData?.code;
        const msg = respData?.msg || error?.message;

        // Si es el error -1021 (timestamp fuera de recvWindow), sincroniza la hora y reintenta una vez
        if (code === -1021 || (typeof msg === 'string' && msg.includes('recvWindow'))) {
            try {
                await syncServerTime(); // actualiza timeOffset
                // reconstruir params con timestamp actualizado
                const retryParams = new URLSearchParams({
                    symbol,
                    timestamp: getAdjustedTimestamp(),
                    recvWindow: DEFAULT_RECV_WINDOW,
                });

                const retryRes = await callMyTrades(retryParams);
                return retryRes.data.filter((t: any) => t.orderId === orderId)[0];
            } catch (retryErr) {
                // loguea y propaga el error del reintento
                log.error({ err: retryErr, body: retryErr.response ? retryErr.response.data : retryErr.message }, 'Error en getOrderInformation (reintento fallido)');
                throw retryErr;
            }
        }

        // Si no es -1021 o el reintento no aplica, loguea y propaga el error original
        log.error({ err: error, body: respData || error.message }, 'Error en getOrderInformation');
        throw error;
    }
}