/**
 * @file Módulo para interactuar con la API de Binance para realizar operaciones de trading.
 */

import axios, { AxiosRequestConfig } from "axios"
import dotenv from 'dotenv';
import { Spot } from '@binance/connector';
import { USDMClient } from "binance";
import util from 'util';

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
        console.error(`${label} message:`, err?.message ?? err);
        if (err?.stack) console.error(`${label} stack:`, err.stack);
        if (err?.response) {
            console.error(`${label} response status:`, err.response.status);
            console.error(`${label} response data:`, util.inspect(err.response.data, { depth: 6 }));
            console.error(`${label} response headers:`, util.inspect(err.response.headers, { depth: 2 }));
        }
        if (err?.config) {
            console.error(`${label} request config:`, util.inspect({
                method: err.config.method,
                url: err.config.url,
                headers: err.config.headers,
                data: err.config.data
            }, { depth: 4 }));
        }
    } catch (loggingErr) {
        console.error('Error while logging error:', loggingErr);
    }
}

function validateEnv() {
    console.log('BINANCE config:');
    console.log('  Binance_ApiKey:', redact(process.env.Binance_ApiKey));
    console.log('  Binance_ApiSecret:', process.env.Binance_ApiSecret ? '<SET>' : '<MISSING>');
    console.log('  targetBaseUrl:', targetBaseUrl);
    console.log('Node version:', process.version);
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

validateEnv();

// Initialize official Binance connector (Spot)
const spot = new Spot(apiKey, apiSecret, { baseURL: targetBaseUrl });
const futures = new USDMClient({
    api_key: process.env.Binance_ApiKey,
    api_secret: process.env.Binance_ApiSecret,
    testnet: true,
});

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
                    await movementsPartial.save();
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

                await movements.save();

            }
            else if (market.toUpperCase() === 'FUTURE') {

                await futures.setLeverage({ symbol: epic, leverage: leverage });

                const order = await futures.submitNewOrder({ symbol: epic, side: 'BUY', type: 'MARKET', quantity: quantity });

                const position = await futures.getOrder({ symbol: epic, orderId: order.orderId });

                const movements = new movementsModel({
                    idRefBroker: position.orderId,
                    strategy: strategy,
                    market: market.toUpperCase(),
                    type: type,
                    margen: leverage,
                    size: quantity,
                    epic: epic,
                    open: true,
                    buyPrice: position.cumQuote,
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
        catch (error: any) {
            safeLogError('spot.newOrder ERROR', error);
            throw error; // o return un mensaje controlado
        }


    }

    if (type.toUpperCase() === 'SELL') {

        try {

            if (market.toUpperCase() === 'SPOT') {

                const ordenes = await movementsModel.find({ strategy: strategy, open: true, broker: 'binance' });

                if (ordenes.length > 0) {
                    for (let orden of ordenes) {

                        console.log(`Attempting SPOT SELL for epic=${orden.epic}, qty=${orden.size}`);
                        const order = await spot.newOrder(orden.epic, 'SELL', 'MARKET', { quantity: orden.size });
                        const fills = order?.data?.fills;
                        if (!fills || fills.length === 0) {
                            console.warn('spot.newOrder (SELL) returned no fills:', util.inspect(order?.data ?? order, { depth: 4 }));
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

                        const cierre = trades.filter(t => t.orderId === order.orderId);

                        const totalQty = cierre.reduce((acc, t) => acc + Number(t.qty), 0);
                        const totalQuote = cierre.reduce((acc, t) => acc + Number(t.quoteQty), 0);
                        const avgPrice = totalQuote / totalQty;
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
            safeLogError('positionBuy SELL ERROR', error);
            return "Error en la ejecución de la orden.";
        }

    }


}

export const positionSell = async (type: string, market: string, epic: string, leverage: number, quantity: number, strategy: string) => {

    if (type.toUpperCase() === 'SELL') {

        try {
            if (market.toUpperCase() === 'SPOT') {
                console.log(`Attempting SPOT (positionSell) SELL: epic=${epic}, qty=${quantity}`);
                const order = await spot.newOrder(epic, 'SELL', 'MARKET', { quantity: quantity });

                const fills = order?.data?.fills;
                if (!fills || fills.length === 0) {
                    console.warn('spot.newOrder returned no fills (positionSell):', util.inspect(order?.data ?? order, { depth: 4 }));
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

                const position = await futures.getOrder({ symbol: epic, orderId: order.orderId });

                const movements = new movementsModel({
                    idRefBroker: position.orderId,
                    strategy: strategy,
                    market: market.toUpperCase(),
                    type: type,
                    margen: leverage,
                    size: quantity,
                    epic: epic,
                    open: true,
                    buyPrice: position.cumQuote,
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
            safeLogError('positionSell SELL ERROR', error);
            return "Error en la ejecución de la orden.";
        }


    }

    if (type.toUpperCase() === 'BUY') {

        try {

            if (market.toUpperCase() === 'SPOT') {

                const ordenes = await movementsModel.find({ strategy: strategy, open: true, broker: 'binance' });

                if (ordenes.length > 0) {
                    for (let orden of ordenes) {

                        console.log(`Attempting SPOT (positionSell) BUY for epic=${orden.epic}, qty=${orden.size}`);
                        const order = await spot.newOrder(orden.epic, 'BUY', 'MARKET', { quantity: orden.size });
                        const fills = order?.data?.fills;
                        if (!fills || fills.length === 0) {
                            console.warn('spot.newOrder (BUY close) returned no fills:', util.inspect(order?.data ?? order, { depth: 4 }));
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

                        const totalQty = cierre.reduce((acc, t) => acc + Number(t.qty), 0);
                        const totalQuote = cierre.reduce((acc, t) => acc + Number(t.quoteQty), 0);
                        const avgPrice = totalQuote / totalQty;
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