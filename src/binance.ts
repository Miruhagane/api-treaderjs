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
import HistoryModel from "./config/models/history";
import { errorSendEmail } from "./config/mail";
import { Server } from "socket.io";
import { dashboard } from "./config/db/dashboard";

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
const spot = new Spot(apiKey, apiSecret, { baseURL: targetBaseUrl });
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
export const positionBuy = async (type: string, market: string, epic: string, leverage: number, quantity: number, strategy: string) => {

    if (type.toUpperCase() === 'BUY') {

        try {
            if (market.toUpperCase() === 'SPOT') {

                // Sanity check
                if (!apiKey || !apiSecret) {
                    throw new Error('Missing Binance_ApiKey or Binance_ApiSecret');
                }

                const order = await spot.newOrder(epic, 'BUY', 'MARKET', { quantity: 0.001 });

                // seguridad: validar que fills exista antes de acceder
                const fills = order?.data?.fills;
                if (!fills || fills.length === 0) {
                    // Log del error para facilitar debugging y notificar por email
                    try {
                        safeLogError('positionBuy SPOT no fills', { order: order?.data, epic, quantity, strategy, market, type });
                        await errorSendEmail('positionBuy SPOT no fills', JSON.stringify({ order: order?.data, epic, quantity, strategy, market, type }, null, 2));
                    } catch (e) {
                        // ignore logging/email errors
                    }

                    // decide cómo manejarlo: aquí retornamos un mensaje y guardamos registro parcial
                    const movementsPartial = new movementsModel({
                        idRefBroker: order?.data?.orderId ?? null,
                        strategy,
                        market: market.toUpperCase(),
                        type,
                        margen: 0,
                        size: quantity,
                        epic,
                        open: true,
                        buyPrice: 0,
                        sellPrice: 0,
                        ganancia: 0,
                        broker: 'binance',
                        date: new Date(),
                        myRegionalDate: new Date().setHours(new Date().getHours() - 5)
                    });
                    let movement = await movementsPartial.save();

                    console.log('Saved partial movement due to no fills:', movement);
                    return 'Orden ejecutada pero no se recibieron fills; revisa logs.';
                }

                const fill = fills[0];

                const movements = new movementsModel({
                    idRefBroker: order.data.orderId,
                    strategy: strategy,
                    market: market.toUpperCase(),
                    type: type,
                    margen: 0,
                    size: quantity,
                    epic: epic,
                    open: true,
                    buyPrice: Number(fill.price) * Number(fill.qty),
                    sellPrice: 0,
                    ganancia: 0,
                    broker: 'binance',
                    date: new Date(),
                    myRegionalDate: new Date().setHours(new Date().getHours() - 5)
                })

                let movement = await movements.save();

            }
            else if (market.toUpperCase() === 'FUTURE') {

                await futures.setLeverage({ symbol: epic, leverage: leverage });

                const order = await futures.submitNewOrder({ symbol: epic, side: 'BUY', type: 'MARKET', quantity: quantity });
                console.log('FUTURE order response:', util.inspect(order, { depth: null }));

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
                console.log('FUTURE movement saved:', movement);
            }
            else {
                return "Tipo de mercado no soportado.";
            }

            return " Orden de compra ejecutada y registrada en la base de datos."

        }
        catch (error: any) {
            try {
                safeLogError('future.newOrder ERROR', error);
                await errorSendEmail('future.newOrder ERROR', JSON.stringify({ message: error?.message, stack: error?.stack }, null, 2));
            } catch (e) {
                // ignore logging/email errors
            }
            throw error; // o return un mensaje controlado
        }


    }

    if (type.toUpperCase() === 'SELL') {

        try {

            if (market.toUpperCase() === 'SPOT') {

                const ordenes = await movementsModel.find({ strategy: strategy, open: true, broker: 'binance' });

                if (ordenes.length > 0) {
                    for (let orden of ordenes) {

                        // logging removed
                        const order = await spot.newOrder(orden.epic, 'SELL', 'MARKET', { quantity: orden.size });
                        const fills = order?.data?.fills;
                        if (!fills || fills.length === 0) {
                            try {
                                safeLogError('positionBuy SPOT SELL no fills', { order: order?.data, ordenId: orden._id, epic: orden.epic });
                                await errorSendEmail('positionBuy SPOT SELL no fills', JSON.stringify({ order: order?.data, ordenId: orden._id, epic: orden.epic }, null, 2));
                            } catch (e) {
                                // ignore logging/email errors
                            }

                            await movementsModel.updateOne({ _id: orden._id }, { $set: { open: false, sellPrice: 0, ganancia: 0 } });
                            continue;
                        }
                        const fill = fills[0];

                        let ganancia = Number(fill.price) * Number(fill.qty) - orden.buyPrice;
                        await movementsModel.updateOne({ _id: orden._id }, { $set: { open: false, sellPrice: Number(fill.price) * Number(fill.qty), ganancia: ganancia } });

                    }
                }
            }

            else if (market.toUpperCase() === 'FUTURE') {

                const ordenes = await movementsModel.find({ strategy: strategy, open: true, broker: 'binance' });

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
                const order = await spot.newOrder(epic, 'SELL', 'MARKET', { quantity: quantity });

                const fills = order?.data?.fills;
                if (!fills || fills.length === 0) {
                    try {
                        safeLogError('positionSell SPOT no fills', { order: order?.data, epic, quantity, strategy, market, type });
                        await errorSendEmail('positionSell SPOT no fills', JSON.stringify({ order: order?.data, epic, quantity, strategy, market, type }, null, 2));
                    } catch (e) {
                        // ignore logging/email errors
                    }
                } else {
                    const fill = fills[0];

                    const movements = new movementsModel({
                        idRefBroker: order.data.orderId,
                        strategy: strategy,
                        market: market.toUpperCase(),
                        type: type,
                        margen: 0,
                        size: quantity,
                        epic: epic,
                        open: true,
                        buyPrice: Number(fill.price) * Number(fill.qty),
                        sellPrice: 0,
                        ganancia: 0,
                        broker: 'binance',
                        date: new Date(),
                        myRegionalDate: new Date().setHours(new Date().getHours() - 5)
                    })

                    await movements.save();
                }

                // io.emit('dashboard_update', { type: type, strategy: strategy });
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

                const ordenes = await movementsModel.find({ strategy: strategy, open: true, broker: 'binance' });

                if (ordenes.length > 0) {
                    for (let orden of ordenes) {

                        // logging removed
                        const order = await spot.newOrder(orden.epic, 'BUY', 'MARKET', { quantity: orden.size });
                        const fills = order?.data?.fills;
                        if (!fills || fills.length === 0) {
                            // logging removed
                            await movementsModel.updateOne({ _id: orden._id }, { $set: { open: false, sellPrice: 0, ganancia: 0 } });
                            continue;
                        }
                        const fill = fills[0];

                        let ganancia = Number(fill.price) * Number(fill.qty) - orden.buyPrice;
                        await movementsModel.updateOne({ _id: orden._id }, { $set: { open: false, sellPrice: Number(fill.price) * Number(fill.qty), ganancia: ganancia } });

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