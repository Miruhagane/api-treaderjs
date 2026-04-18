/**
 * @file Módulo para interactuar con la API de Binance para realizar operaciones de trading.
 */

import axios, { AxiosRequestConfig } from "axios"
import dotenv from 'dotenv';
import { Spot } from '@binance/connector';
import { USDMClient } from "binance";
import util from 'util';
import WebSocket from 'ws';

dotenv.config();


import movementsModel from "./config/models/movements";
import { errorSendEmail } from "./config/mail";
import { Server } from "socket.io";
import { binanceMarket } from "./lib/binance/market";


/**
 * Helpers de logging/validación
 */
function redact(key?: string) {
    if (!key) return '<MISSING>';
    return key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '<SET>';
}

function safeLogError(label: string, err: any) {
    try {
        // logging removed
    } catch (loggingErr) {
        // logging removed
    }
}

function validateEnv() {
    // environment validation logs removed
}

/**
 * Tipos
 */
interface CryptoBalance {
    available: string;
    onOrder: string;
}

interface Balances {
    [key: string]: CryptoBalance;
    BTC?: CryptoBalance;
}

/**
 * Configuración
 */
const apiKey = process.env.Binance_ApiKey;
const apiSecret = process.env.Binance_ApiSecret;

const targetBaseUrl = process.env.BINANCE_BASEURL || 'https://testnet.binance.vision';
const isFuturesTestnet = process.env.BINANCE_TESTNET ? process.env.BINANCE_TESTNET === 'true' : true;
const futuresRestBaseUrl = process.env.BINANCE_FUTURES_BASEURL || (isFuturesTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com');
const futuresWsBaseUrl = process.env.BINANCE_FUTURES_WS_URL || (isFuturesTestnet ? 'wss://stream.binancefuture.com/ws' : 'wss://fstream.binance.com/ws');





validateEnv();

// Initialize official Binance connector (Spot)
const spot = new Spot(apiKey, apiSecret, { baseURL: 'https://demo.binance.com' });
const futures = new USDMClient({
    api_key: process.env.Binance_ApiKey,
    api_secret: process.env.Binance_ApiSecret,
    testnet: true,
});

/**
 * Binance Futures User Data Stream (WebSocket)
 * Emite cambios de posición en tiempo real para posiciones abiertas.
 */
let futuresUserWs: WebSocket | null = null;
let futuresListenKeyKeepAliveTimer: NodeJS.Timeout | null = null;
let futuresReconnectTimer: NodeJS.Timeout | null = null;
let futuresStreamStarted = false;
const openPositionsCache = new Map<string, number>();
const CONTINUOUS_EXECUTION_MODE = 'CONTINUOUS';

function getContinuousPositionsFilter(epic: string, strategy: string, market: string) {
    return {
        broker: 'binance',
        epic,
        strategy,
        market: String(market).toUpperCase(),
        open: true,
        executionMode: CONTINUOUS_EXECUTION_MODE,
    };
}

function markOpenPosition(symbol: string) {
    const normalizedSymbol = String(symbol || '').toUpperCase();
    if (!normalizedSymbol) return;
    openPositionsCache.set(normalizedSymbol, (openPositionsCache.get(normalizedSymbol) || 0) + 1);
}

function buildRegionalDate() {
    const regionalDate = new Date();
    regionalDate.setHours(regionalDate.getHours() - 5);
    return regionalDate;
}

async function refreshOpenPositionsCache() {
    const openPositions = await movementsModel.find(
        { broker: 'binance', market: 'FUTURE', open: true },
        { epic: 1 }
    );
    openPositionsCache.clear();
    for (const pos of openPositions) {
        const symbol = String(pos.epic || '').toUpperCase();
        if (!symbol) continue;
        openPositionsCache.set(symbol, (openPositionsCache.get(symbol) || 0) + 1);
    }
}

async function getFuturesListenKey() {
    if (!apiKey) {
        throw new Error('Missing Binance_ApiKey for Futures listenKey');
    }
    const config: AxiosRequestConfig = {
        method: 'POST',
        url: `${futuresRestBaseUrl}/fapi/v1/listenKey`,
        headers: { 'X-MBX-APIKEY': apiKey }
    };
    const response = await axios(config);
    const listenKey = response?.data?.listenKey;
    if (!listenKey) {
        throw new Error('Failed to acquire Futures listenKey');
    }
    return listenKey;
}

async function keepAliveFuturesListenKey(listenKey: string) {
    if (!apiKey) return;
    try {
        const config: AxiosRequestConfig = {
            method: 'PUT',
            url: `${futuresRestBaseUrl}/fapi/v1/listenKey`,
            headers: { 'X-MBX-APIKEY': apiKey },
            params: { listenKey }
        };
        await axios(config);
    } catch (err) {
        safeLogError('Futures listenKey keepAlive ERROR', err);
    }
}

function scheduleFuturesReconnect(io: Server) {
    if (futuresReconnectTimer) return;
    futuresReconnectTimer = setTimeout(async () => {
        futuresReconnectTimer = null;
        try {
            await startBinanceFuturesPositionStream(io, true);
        } catch (err) {
            safeLogError('Futures WS reconnect ERROR', err);
            scheduleFuturesReconnect(io);
        }
    }, 5000);
}

async function handleFuturesUserDataMessage(io: Server, message: any) {
    const eventType = message?.e;

    if (eventType === 'ACCOUNT_UPDATE' && message?.a?.P) {
        const balanceByAsset = new Map<string, any>();
        const balances = Array.isArray(message?.a?.B) ? message.a.B : [];
        for (const bal of balances) {
            const asset = String(bal?.a || '').toUpperCase();
            if (!asset) continue;
            balanceByAsset.set(asset, bal);
        }

        for (const position of message.a.P) {
            const symbol = String(position?.s || '').toUpperCase();
            if (!symbol) continue;

            if (!openPositionsCache.has(symbol)) {
                continue;
            }

            const marginAsset = String(position?.ma || '').toUpperCase();
            const balance = marginAsset ? balanceByAsset.get(marginAsset) : null;
            const positionAmt = Number(position?.pa || 0);
            const entryPrice = Number(position?.ep || 0);
            const unrealizedPnl = Number(position?.up || 0);
            const leverage = Number(position?.l || 0);

            io.emit('binance_position_update', {
                broker: 'binance',
                market: 'FUTURE',
                eventType,
                eventTime: message?.E,
                symbol,
                marginAsset,
                crossWalletBalance: balance?.cw ? Number(balance.cw) : null,
                walletBalance: balance?.wb ? Number(balance.wb) : null,
                positionAmt,
                entryPrice,
                unrealizedPnl,
                leverage,
                raw: message
            });

            if (positionAmt === 0) {
                await movementsModel.updateMany(
                    { broker: 'binance', market: 'FUTURE', open: true, epic: symbol },
                    { $set: { open: false } }
                );
                openPositionsCache.delete(symbol);
            }
        }
        return;
    }

    if (eventType === 'ORDER_TRADE_UPDATE' && message?.o) {
        const symbol = String(message.o?.s || '').toUpperCase();
        if (symbol && openPositionsCache.has(symbol)) {
            io.emit('binance_position_update', {
                broker: 'binance',
                market: 'FUTURE',
                eventType,
                eventTime: message?.E,
                symbol,
                order: message.o,
                raw: message
            });
        }
    }
}

function connectFuturesUserDataWs(io: Server, listenKey: string) {
    const wsUrl = `${futuresWsBaseUrl}/${listenKey}`;
    futuresUserWs = new WebSocket(wsUrl);

    futuresUserWs.on('open', () => {
        // connection opened (logging removed)
    });

    futuresUserWs.on('message', async (data) => {
        try {
            const parsed = JSON.parse(data.toString());
            await handleFuturesUserDataMessage(io, parsed);
        } catch (err) {
            safeLogError('Futures WS message ERROR', err);
        }
    });

    futuresUserWs.on('error', (err) => {
        safeLogError('Futures WS ERROR', err);
    });

    futuresUserWs.on('close', () => {
        // connection closed (logging removed)
        scheduleFuturesReconnect(io);
    });
}

export const startBinanceFuturesPositionStream = async (io: Server, isReconnect = false) => {
    if (futuresStreamStarted && !isReconnect) return;
    futuresStreamStarted = true;

    if (!apiKey) {
        // missing API key (logging removed)
        return;
    }

    await refreshOpenPositionsCache();

    const listenKey = await getFuturesListenKey();

    if (futuresUserWs) {
        try {
            futuresUserWs.close();
        } catch (err) {
            safeLogError('Futures WS close ERROR', err);
        }
        futuresUserWs = null;
    }

    if (futuresListenKeyKeepAliveTimer) {
        clearInterval(futuresListenKeyKeepAliveTimer);
    }

    futuresListenKeyKeepAliveTimer = setInterval(() => {
        keepAliveFuturesListenKey(listenKey);
    }, 30 * 60 * 1000);

    connectFuturesUserDataWs(io, listenKey);
};

/**
 * positionBuy
 */
export const positionBuy = async (type: string, market: string, epic: string, leverage: number, quantity: number, strategy: string, io: Server) => {

    if (type.toUpperCase() === 'BUY') {

        try {
            if (market.toUpperCase() === 'SPOT') {

                const order = await binanceMarket(epic, quantity, type.toUpperCase());

                const movementsPartial = new movementsModel({
                    idRefBroker: order.orderId,
                    strategy,
                    market: market.toUpperCase(),
                    type,
                    margen: 0,
                    size: Number(order.qty).toFixed(5) || 0,
                    spotsizeSell: 0,
                    epic,
                    open: true,
                    buyPrice: Number(order.price),
                    sellPrice: 0,
                    brokercommission: Number(order.commission).toFixed(8) || 0,
                    brokercommissionSell: 0,
                    ganancia: 0,
                    broker: 'binance',
                    date: new Date(),
                    myRegionalDate: new Date().setHours(new Date().getHours() - 5)
                });

                await movementsPartial.save();
            }
            else if (market.toUpperCase() === 'FUTURE') {

                await futures.setLeverage({ symbol: epic, leverage: leverage });

                const order = await futures.submitNewOrder({ symbol: epic, side: 'BUY', type: 'MARKET', quantity: quantity });

                // intentamos obtener orderId de distintas formas (diferentes formas de respuesta según SDK/entorno)
                const orderAny: any = order;
                const orderId = orderAny?.orderId ?? orderAny?.orderIdStr ?? orderAny?.data?.orderId ?? null;

                // logging removed
                let position: any = null;
                if (orderId) {
                    try {
                        position = await futures.getOrder({ symbol: epic, orderId: orderId });
                    } catch (err: any) {
                        // Manejo específico cuando Binance responde que la orden no existe
                        const msg = String(err?.message || err?.msg || '');
                        safeLogError('futures.getOrder ERROR', { err, epic, orderId });
                        if (msg.includes('Order does not exist') || msg.includes('order does not exist')) {
                            try {
                                // Intentamos reconstruir la información a partir de trades de la cuenta
                                const trades = await futures.getAccountTrades({ symbol: epic });
                                const cierre = trades.filter((t: any) => String(t.orderId) === String(orderId));
                                if (cierre && cierre.length > 0) {
                                    const totalQty = cierre.reduce((acc: number, t: any) => acc + Number(t.qty || 0), 0);
                                    const totalQuote = cierre.reduce((acc: number, t: any) => acc + Number(t.quoteQty || t.quote || 0), 0);
                                    position = { orderId, cumQuote: totalQuote, executedQty: totalQty };
                                } else {
                                    // fallback: usar posibles campos del response `order` si existen
                                    position = { orderId, cumQuote: order?.cumQuote ?? order?.executedQty ?? 0 };
                                }
                            } catch (e) {
                                safeLogError('rebuild position from trades ERROR', e);
                                position = { orderId, cumQuote: order?.cumQuote ?? 0 };
                            }
                        } else {
                            throw err;
                        }
                    }
                } else {
                    safeLogError('submitNewOrder returned no orderId', { order, epic, quantity, strategy });
                    // Intentamos obtener trades recientes como fallback
                    try {
                        const trades = await futures.getAccountTrades({ symbol: epic });
                        const recent = trades.slice(-5);
                        const totalQuote = recent.reduce((acc: number, t: any) => acc + Number(t.quoteQty || t.quote || 0), 0);
                        position = { orderId: null, cumQuote: totalQuote };
                    } catch (e) {
                        position = { orderId: null, cumQuote: 0 };
                    }
                }

                // logging removed
                if (!position || !position.orderId) {
                    try {
                        safeLogError('positionBuy FUTURE missing position', { order, position, epic, quantity, strategy });
                        await errorSendEmail('positionBuy FUTURE missing position', JSON.stringify({ order, position, epic, quantity, strategy }, null, 2));
                    } catch (e) {
                        // ignore logging/email errors
                    }
                }

                const movements = await new movementsModel({
                    idRefBroker: position?.orderId ?? orderId ?? order?.orderId ?? null,
                    strategy: strategy,
                    market: market.toUpperCase(),
                    type: type,
                    margen: leverage,
                    size: quantity,
                    epic: epic,
                    open: true,
                    buyPrice: position?.cumQuote ?? order?.cumQuote ?? 0,
                    sellPrice: 0,
                    ganancia: 0,
                    broker: 'binance',
                    date: new Date(),
                    myRegionalDate: new Date().setHours(new Date().getHours() - 5)
                })
                let movement = await movements.save();
                // logging removed
            }
            else {
                return "Tipo de mercado no soportado.";
            }

            io.emit('posicion_event', { type: type, strategy: strategy });
            return " Orden de compra ejecutada y registrada en la base de datos."

        }
        catch (error: any) {
            try {

                await errorSendEmail('newOrder ERROR', JSON.stringify({ message: error?.message, stack: error?.stack }, null, 2));
            } catch (e) {
                // ignore logging/email errors
            }
            throw error; // o return un mensaje controlado
        }


    }

    if (type.toUpperCase() === 'SELL') {

        try {

            if (market.toUpperCase() === 'SPOT') {

                const ordenes = await movementsModel.find({ strategy: strategy, open: true, broker: 'binance', market: 'SPOT' }).sort({ date: -1 });
                if (ordenes.length > 0) {
                    for (let orden of ordenes) {
                        const binanceOrder = await binanceMarket(orden.epic, orden.size, type.toUpperCase());

                        let ganancia = (Number(binanceOrder.price) - Number(orden.buyPrice)) * Number(orden.size);
                        await movementsModel.updateOne({ _id: orden._id }, { $set: { open: false, sellPrice: binanceOrder.price, spotsizeSell: binanceOrder.qty, brokercommissionSell: binanceOrder.commission, ganancia: Number(ganancia).toFixed(5) } });
                    }
                }


            }

            else if (market.toUpperCase() === 'FUTURE') {

                const ordenes = await movementsModel.find({ strategy: strategy, open: true, broker: 'binance', market: 'FUTURE' }).sort({ date: -1 });

                if (ordenes.length > 0) {
                    for (let orden of ordenes) {
                        const order = await futures.submitNewOrder({ symbol: orden.epic, side: 'SELL', type: 'MARKET', quantity: orden.size });
                        const trades = await futures.getAccountTrades({ symbol: orden.epic });
                        const cierre = trades.filter(t => String(t.orderId) === String(order.orderId));

                        if (!cierre || cierre.length === 0) {
                            try {
                                safeLogError('positionBuy FUTURE SELL no trades for order', { order, trades, ordenId: orden._id, epic: orden.epic });
                                await errorSendEmail('positionBuy FUTURE SELL no trades for order', JSON.stringify({ order, trades, ordenId: orden._id, epic: orden.epic }, null, 2));
                            } catch (e) {
                                // ignore logging/email errors
                            }

                            await movementsModel.updateOne({ _id: orden._id }, { $set: { open: false, sellPrice: 0, ganancia: 0 } });
                            continue;
                        }

                        const totalQty = cierre.reduce((acc, t) => acc + Number(t.qty), 0);
                        const totalQuote = cierre.reduce((acc, t) => acc + Number(t.quoteQty), 0);
                        const avgPrice = totalQty === 0 ? 0 : totalQuote / totalQty;
                        const totalPnl = cierre.reduce((acc, t) => acc + Number(t.realizedPnl), 0);
                        await movementsModel.updateOne({ _id: orden._id }, { $set: { open: false, sellPrice: avgPrice, ganancia: totalPnl } });
                    }
                }

            }
            else {
                return "Tipo de mercado no soportado.";
            }

            io.emit('posicion_event', { type: type, strategy: strategy });
            return " Orden de venta ejecutada y registros actualizados."
        } catch (error) {
            try {
                safeLogError('positionbuy SELL ERROR', error);
                await errorSendEmail('positionbuy SELL ERROR', JSON.stringify({ message: error?.message, stack: error?.stack }, null, 2));
            } catch (e) {
                // ignore logging/email errors
            }
            return "Error en la ejecución de la orden.";
        }

    }


}

export const positionSell = async (type: string, market: string, epic: string, leverage: number, quantity: number, strategy: string) => {

    if (type.toUpperCase() === 'SELL') {

        try {
            if (market.toUpperCase() === 'SPOT') {
                // logging removed
                const order = await binanceMarket(epic, quantity, type.toUpperCase());

                const movementsPartial = new movementsModel({
                    idRefBroker: order.orderId,
                    strategy,
                    market: market.toUpperCase(),
                    type,
                    margen: 0,
                    size: Number(order.qty).toFixed(5) || 0,
                    spotsizeSell: 0,
                    epic,
                    open: true,
                    buyPrice: Number(order.price),
                    sellPrice: 0,
                    brokercommission: Number(order.commission).toFixed(8) || 0,
                    brokercommissionSell: 0,
                    ganancia: 0,
                    broker: 'binance',
                    date: new Date(),
                    myRegionalDate: new Date().setHours(new Date().getHours() - 5)
                });

                await movementsPartial.save();

                // io.emit('posicion_event', { type: type, strategy: strategy });
            }
            else if (market.toUpperCase() === 'FUTURE') {

                await futures.setLeverage({ symbol: epic, leverage: leverage });

                const order = await futures.submitNewOrder({ symbol: epic, side: 'SELL', type: 'MARKET', quantity: quantity });

                // intentamos obtener orderId de distintas formas
                const orderAny: any = order;
                const orderId = orderAny?.orderId ?? orderAny?.orderIdStr ?? orderAny?.data?.orderId ?? null;
                let position: any = null;
                if (orderId) {
                    try {
                        position = await futures.getOrder({ symbol: epic, orderId: orderId });
                    } catch (err: any) {
                        const msg = String(err?.message || err?.msg || '');
                        safeLogError('futures.getOrder ERROR', { err, epic, orderId });
                        if (msg.includes('Order does not exist') || msg.includes('order does not exist')) {
                            try {
                                const trades = await futures.getAccountTrades({ symbol: epic });
                                const cierre = trades.filter((t: any) => String(t.orderId) === String(orderId));
                                if (cierre && cierre.length > 0) {
                                    const totalQty = cierre.reduce((acc: number, t: any) => acc + Number(t.qty || 0), 0);
                                    const totalQuote = cierre.reduce((acc: number, t: any) => acc + Number(t.quoteQty || t.quote || 0), 0);
                                    position = { orderId, cumQuote: totalQuote, executedQty: totalQty };
                                } else {
                                    position = { orderId, cumQuote: order?.cumQuote ?? order?.executedQty ?? 0 };
                                }
                            } catch (e) {
                                safeLogError('rebuild position from trades ERROR', e);
                                position = { orderId, cumQuote: order?.cumQuote ?? 0 };
                            }
                        } else {
                            throw err;
                        }
                    }
                } else {
                    safeLogError('submitNewOrder returned no orderId', { order, epic, quantity, strategy });
                    try {
                        const trades = await futures.getAccountTrades({ symbol: epic });
                        const recent = trades.slice(-5);
                        const totalQuote = recent.reduce((acc: number, t: any) => acc + Number(t.quoteQty || t.quote || 0), 0);
                        position = { orderId: null, cumQuote: totalQuote };
                    } catch (e) {
                        position = { orderId: null, cumQuote: 0 };
                    }
                }

                if (!position || !position.orderId) {
                    try {
                        safeLogError('positionSell FUTURE missing position', { order, position, epic, quantity, strategy });
                        await errorSendEmail('positionSell FUTURE missing position', JSON.stringify({ order, position, epic, quantity, strategy }, null, 2));
                    } catch (e) {
                        // ignore logging/email errors
                    }
                }
                const movements = new movementsModel({
                    idRefBroker: position?.orderId ?? orderId ?? order?.orderId ?? null,
                    strategy: strategy,
                    market: market.toUpperCase(),
                    type: type,
                    margen: leverage,
                    size: quantity,
                    epic: epic,
                    open: true,
                    buyPrice: position?.cumQuote ?? order?.cumQuote ?? 0,
                    sellPrice: 0,
                    ganancia: 0,
                    broker: 'binance',
                    date: new Date(),
                    myRegionalDate: new Date().setHours(new Date().getHours() - 5)
                })
                await movements.save();
            }
            else {
                return "Tipo de mercado no soportado.";
            }

            return " Orden de compra ejecutada y registrada en la base de datos."

        }
        catch (error) {
            try {
                safeLogError('positionSell SELL ERROR', error);
                await errorSendEmail('positionSell SELL ERROR', JSON.stringify({ message: error?.message, stack: error?.stack }, null, 2));
            } catch (e) {
                // ignore logging/email errors
            }
            return "Error en la ejecución de la orden.";
        }


    }

    if (type.toUpperCase() === 'BUY') {

        try {

            if (market.toUpperCase() === 'SPOT') {

                const ordenes = await movementsModel.find({ strategy: strategy, open: true, broker: 'binance', market: 'SPOT' }).sort({ date: -1 });
                if (ordenes.length > 0) {
                    for (let orden of ordenes) {
                        const binanceOrder = await binanceMarket(orden.epic, orden.size, type.toUpperCase());

                        let ganancia = (Number(orden.buyPrice) - Number(binanceOrder.price)) * Number(orden.size);
                        await movementsModel.updateOne({ _id: orden._id }, { $set: { open: false, sellPrice: binanceOrder.price, spotsizeSell: binanceOrder.qty, brokercommissionSell: binanceOrder.commission, ganancia: Number(ganancia).toFixed(5) } });
                    }
                }
            }

            else if (market.toUpperCase() === 'FUTURE') {

                const ordenes = await movementsModel.find({ strategy: strategy, open: true, broker: 'binance' });

                if (ordenes.length > 0) {
                    for (let orden of ordenes) {
                        const order = await futures.submitNewOrder({ symbol: orden.epic, side: 'BUY', type: 'MARKET', quantity: orden.size });
                        const trades = await futures.getAccountTrades({ symbol: orden.epic });

                        const cierre = trades.filter(t => t.orderId === order.orderId);

                        if (!cierre || cierre.length === 0) {
                            try {
                                safeLogError('positionSell FUTURE BUY no trades for order', { order, trades, ordenId: orden._id, epic: orden.epic });
                                await errorSendEmail('positionSell FUTURE BUY no trades for order', JSON.stringify({ order, trades, ordenId: orden._id, epic: orden.epic }, null, 2));
                            } catch (e) {
                                // ignore logging/email errors
                            }

                            await movementsModel.updateOne({ _id: orden._id }, { $set: { open: false, sellPrice: 0, ganancia: 0 } });
                            continue;
                        }

                        const totalQty = cierre.reduce((acc, t) => acc + Number(t.qty), 0);
                        const totalQuote = cierre.reduce((acc, t) => acc + Number(t.quoteQty), 0);
                        const avgPrice = totalQty === 0 ? 0 : totalQuote / totalQty;
                        const totalPnl = cierre.reduce((acc, t) => acc + Number(t.realizedPnl), 0);
                        await movementsModel.updateOne({ _id: orden._id }, { $set: { open: false, sellPrice: avgPrice, ganancia: totalPnl } });
                    }
                }

            }
            else {
                return "Tipo de mercado no soportado.";
            }

            return " Orden de venta ejecutada y registros actualizados."
        } catch (error) {
            safeLogError('positionSell BUY ERROR', error);
            return "Error en la ejecución de la orden.";
        }

    }
}

export const positionContinuous = async (type: string, market: string, epic: string, leverage: number, quantity: number, strategy: string, io: Server) => {
    const normalizedType = String(type || '').toUpperCase();
    const normalizedMarket = String(market || '').toUpperCase();
    const normalizedEpic = String(epic || '').toUpperCase();
    const continuousFilter = getContinuousPositionsFilter(normalizedEpic, strategy, normalizedMarket);
    const continuousOrders = await movementsModel.find(continuousFilter).sort({ date: -1 });
    const currentOpenType = continuousOrders.length > 0 ? String(continuousOrders[0].type || '').toUpperCase() : null;
    const isOpenRequest = !currentOpenType || currentOpenType === normalizedType;

    if (normalizedType !== 'BUY' && normalizedType !== 'SELL') {
        return 'Tipo de operación no soportado.';
    }

    if (isOpenRequest) {
        try {
            const parsedQuantity = Number(quantity);
            if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
                return 'La cantidad para la posición continua debe ser mayor a 0.';
            }

            if (normalizedMarket === 'SPOT') {
                const order = await binanceMarket(normalizedEpic, parsedQuantity, normalizedType);

                const movementsPartial = new movementsModel({
                    idRefBroker: order.orderId,
                    strategy,
                    market: normalizedMarket,
                    executionMode: CONTINUOUS_EXECUTION_MODE,
                    type: normalizedType,
                    margen: 0,
                    size: Number(order.qty).toFixed(5) || 0,
                    spotsizeSell: 0,
                    epic: normalizedEpic,
                    open: true,
                    buyPrice: Number(order.price),
                    sellPrice: 0,
                    brokercommission: Number(order.commission).toFixed(8) || 0,
                    brokercommissionSell: 0,
                    ganancia: 0,
                    broker: 'binance',
                    date: new Date(),
                    myRegionalDate: buildRegionalDate()
                });

                await movementsPartial.save();
                markOpenPosition(normalizedEpic);
            }
            else if (normalizedMarket === 'FUTURE') {
                await futures.setLeverage({ symbol: normalizedEpic, leverage: leverage });

                const order = await futures.submitNewOrder({ symbol: normalizedEpic, side: normalizedType, type: 'MARKET', quantity: parsedQuantity });
                const orderAny: any = order;
                const orderId = orderAny?.orderId ?? orderAny?.orderIdStr ?? orderAny?.data?.orderId ?? null;
                let position: any = null;

                if (orderId) {
                    try {
                        position = await futures.getOrder({ symbol: normalizedEpic, orderId: orderId });
                    } catch (err: any) {
                        const msg = String(err?.message || err?.msg || '');
                        safeLogError('futures.getOrder ERROR', { err, epic: normalizedEpic, orderId });
                        if (msg.includes('Order does not exist') || msg.includes('order does not exist')) {
                            try {
                                const trades = await futures.getAccountTrades({ symbol: normalizedEpic });
                                const cierre = trades.filter((trade: any) => String(trade.orderId) === String(orderId));
                                if (cierre && cierre.length > 0) {
                                    const totalQty = cierre.reduce((acc: number, trade: any) => acc + Number(trade.qty || 0), 0);
                                    const totalQuote = cierre.reduce((acc: number, trade: any) => acc + Number(trade.quoteQty || trade.quote || 0), 0);
                                    position = { orderId, cumQuote: totalQuote, executedQty: totalQty };
                                } else {
                                    position = { orderId, cumQuote: orderAny?.cumQuote ?? orderAny?.executedQty ?? 0 };
                                }
                            } catch (rebuildError) {
                                safeLogError('rebuild continuous position from trades ERROR', rebuildError);
                                position = { orderId, cumQuote: orderAny?.cumQuote ?? 0 };
                            }
                        } else {
                            throw err;
                        }
                    }
                } else {
                    safeLogError('continuous submitNewOrder returned no orderId', { order, epic: normalizedEpic, quantity: parsedQuantity, strategy });
                    try {
                        const trades = await futures.getAccountTrades({ symbol: normalizedEpic });
                        const recent = trades.slice(-5);
                        const totalQuote = recent.reduce((acc: number, trade: any) => acc + Number(trade.quoteQty || trade.quote || 0), 0);
                        position = { orderId: null, cumQuote: totalQuote };
                    } catch (recentTradesError) {
                        position = { orderId: null, cumQuote: 0 };
                    }
                }

                if (!position || !position.orderId) {
                    try {
                        safeLogError('positionContinuous FUTURE missing position', { order, position, epic: normalizedEpic, quantity: parsedQuantity, strategy });
                        await errorSendEmail('positionContinuous FUTURE missing position', JSON.stringify({ order, position, epic: normalizedEpic, quantity: parsedQuantity, strategy }, null, 2));
                    } catch (notificationError) {
                    }
                }

                const movement = new movementsModel({
                    idRefBroker: position?.orderId ?? orderId ?? orderAny?.orderId ?? null,
                    strategy,
                    market: normalizedMarket,
                    executionMode: CONTINUOUS_EXECUTION_MODE,
                    type: normalizedType,
                    margen: leverage,
                    size: parsedQuantity,
                    epic: normalizedEpic,
                    open: true,
                    buyPrice: position?.cumQuote ?? orderAny?.cumQuote ?? 0,
                    sellPrice: 0,
                    ganancia: 0,
                    broker: 'binance',
                    date: new Date(),
                    myRegionalDate: buildRegionalDate()
                });

                await movement.save();
                markOpenPosition(normalizedEpic);
            }
            else {
                return 'Tipo de mercado no soportado.';
            }

            io.emit('posicion_event', { type: normalizedType, strategy, epic: normalizedEpic, market: normalizedMarket, executionMode: CONTINUOUS_EXECUTION_MODE });
            return `Posición continua ${normalizedType} ejecutada y registrada correctamente.`;
        }
        catch (error: any) {
            try {
                safeLogError(`positionContinuous ${normalizedType} OPEN ERROR`, error);
                await errorSendEmail(`positionContinuous ${normalizedType} OPEN ERROR`, JSON.stringify({ message: error?.message, stack: error?.stack, epic: normalizedEpic, strategy, market: normalizedMarket }, null, 2));
            } catch (notificationError) {
            }
            throw error;
        }
    }

    if (currentOpenType && currentOpenType !== normalizedType) {
        try {
            const ordenes = continuousOrders;

            if (ordenes.length === 0) {
                return 'No hay posiciones continuas abiertas para ese epic, strategy y market.';
            }

            if (normalizedMarket === 'SPOT') {
                for (const orden of ordenes) {
                    const binanceOrder = await binanceMarket(normalizedEpic, Number(orden.size), normalizedType);
                    const ganancia = currentOpenType === 'BUY'
                        ? (Number(binanceOrder.price) - Number(orden.buyPrice)) * Number(orden.size)
                        : (Number(orden.buyPrice) - Number(binanceOrder.price)) * Number(orden.size);

                    await movementsModel.updateOne(
                        { _id: orden._id },
                        {
                            $set: {
                                open: false,
                                sellPrice: binanceOrder.price,
                                spotsizeSell: binanceOrder.qty,
                                brokercommissionSell: binanceOrder.commission,
                                ganancia: Number(ganancia).toFixed(5)
                            }
                        }
                    );
                }
            }
            else if (normalizedMarket === 'FUTURE') {
                for (const orden of ordenes) {
                    const order = await futures.submitNewOrder({ symbol: normalizedEpic, side: normalizedType, type: 'MARKET', quantity: Number(orden.size) });
                    const trades = await futures.getAccountTrades({ symbol: normalizedEpic });
                    const cierre = trades.filter((trade: any) => String(trade.orderId) === String((order as any).orderId));

                    if (!cierre || cierre.length === 0) {
                        try {
                            safeLogError(`positionContinuous FUTURE ${normalizedType} no trades for order`, { order, trades, ordenId: orden._id, epic: normalizedEpic });
                            await errorSendEmail(`positionContinuous FUTURE ${normalizedType} no trades for order`, JSON.stringify({ order, trades, ordenId: orden._id, epic: normalizedEpic }, null, 2));
                        } catch (notificationError) {
                        }

                        await movementsModel.updateOne({ _id: orden._id }, { $set: { open: false, sellPrice: 0, ganancia: 0 } });
                        continue;
                    }

                    const totalQty = cierre.reduce((acc: number, trade: any) => acc + Number(trade.qty), 0);
                    const totalQuote = cierre.reduce((acc: number, trade: any) => acc + Number(trade.quoteQty), 0);
                    const avgPrice = totalQty === 0 ? 0 : totalQuote / totalQty;
                    const totalPnl = cierre.reduce((acc: number, trade: any) => acc + Number(trade.realizedPnl), 0);

                    await movementsModel.updateOne(
                        { _id: orden._id },
                        {
                            $set: {
                                open: false,
                                sellPrice: avgPrice,
                                ganancia: totalPnl
                            }
                        }
                    );
                }
            }
            else {
                return 'Tipo de mercado no soportado.';
            }

            await refreshOpenPositionsCache();
            io.emit('posicion_event', { type: normalizedType, strategy, epic: normalizedEpic, market: normalizedMarket, executionMode: CONTINUOUS_EXECUTION_MODE });
            return `Posiciones continuas ${currentOpenType} cerradas con ${normalizedType} correctamente.`;
        } catch (error: any) {
            try {
                safeLogError(`positionContinuous ${normalizedType} CLOSE ERROR`, error);
                await errorSendEmail(`positionContinuous ${normalizedType} CLOSE ERROR`, JSON.stringify({ message: error?.message, stack: error?.stack, epic: normalizedEpic, strategy, market: normalizedMarket }, null, 2));
            } catch (notificationError) {
            }
            throw error;
        }
    }

    return `Las posiciones continuas abiertas en ${normalizedEpic} con strategy ${strategy} deben cerrarse con ${currentOpenType === 'BUY' ? 'SELL' : 'BUY'}.`;
}