/**
 * @file Módulo para interactuar con la API de Binance para realizar operaciones de trading.
 */

import axios, { AxiosRequestConfig } from "axios"
import dotenv from 'dotenv';
import { Spot } from '@binance/connector';
import { USDMClient } from "binance";

dotenv.config();


import movementsModel from "./config/models/movements";
import HistoryModel from "./config/models/history";
import { errorSendEmail } from "./config/mail";
import { Server } from "socket.io";
import { dashboard } from "./config/db/dashboard";

/**
 * @interface CryptoBalance
 * @description Define la estructura del balance de una criptomoneda, incluyendo lo disponible y lo que está en órdenes.
 * @property {string} available - Cantidad de la criptomoneda disponible para operar.
 * @property {string} onOrder - Cantidad de la criptomoneda que está actualmente en órdenes abiertas.
 */
interface CryptoBalance {
    available: string;
    onOrder: string;
}

/**
 * @interface Balances
 * @description Define la estructura del objeto de balances, que puede contener múltiples criptomonedas.
 * @property {CryptoBalance} [key: string] - Permite acceder a cualquier balance de criptomoneda por su símbolo.
 * @property {CryptoBalance} [BTC] - Balance específico para Bitcoin (opcional).
 */
interface Balances {
    [key: string]: CryptoBalance; // Índice de firma para cualquier propiedad
    BTC?: CryptoBalance;          // Opcional
}

/**
 * Inicializa el cliente de Binance con las claves de API y secretos desde las variables de entorno.
 * Configurado para usar el entorno de prueba (testnet).
 */

const apiKey = process.env.Binance_ApiKey;
const apiSecret = process.env.Binance_ApiSecret;
const targetBaseUrl = 'https://demo-api.binance.com';



/**
 * Inicializa el cliente de Binance con las claves de API y secretos desde las variables de entorno.
 * Configurado para usar el entorno de prueba (testnet).
 */
// Initialize official Binance connector (Spot)
const spot = new Spot(apiKey, apiSecret, { baseURL: targetBaseUrl });
const futures = new USDMClient({
    api_key: process.env.Binance_ApiKey,
    api_secret: process.env.Binance_ApiSecret,
    testnet: true,
});
/**
 * @async
 * @function position
 * @description Ejecuta una orden de mercado (compra o venta) para BTCUSDT en Binance y registra el movimiento.
 *              En caso de compra, crea un nuevo registro de movimiento. En caso de venta, actualiza los movimientos abiertos existentes.
 * @param {string} type - El tipo de operación a realizar ('BUY' para compra, 'SELL' para venta).
 * @param {string} strategy - La estrategia de trading asociada a esta operación.
 * @param {Server} io - Instancia del servidor Socket.IO para emitir actualizaciones del dashboard.
 * @returns {Promise<string>} Un mensaje indicando el resultado de la operación (éxito o error).
 */
export const positionBuy = async (type: string, market: string, epic: string, leverage: number, quantity: number, strategy: string) => {

    if (type.toUpperCase() === 'BUY') {

        try {
            if (market.toUpperCase() === 'SPOT') {
                const order = await spot.newOrder(epic, 'BUY', 'MARKET', { quantity: quantity });

                const fill = order.data.fills[0];

                const movements = new movementsModel({
                    idRefBroker: order.data.orderId,
                    strategy: strategy,
                    market: market.toUpperCase(),
                    type: type,
                    margen: 0,
                    size: quantity,
                    epic: epic,
                    open: true,
                    buyPrice: fill.price * fill.qty,
                    sellPrice: 0,
                    ganancia: 0,
                    broker: 'binance',
                    date: new Date(),
                    myRegionalDate: new Date().setHours(new Date().getHours() - 5)
                })

                await movements.save();

                // io.emit('dashboard_update', { type: type, strategy: strategy });
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
        catch (error) {
            console.error("Error de Binance:", JSON.stringify(error, null, 2));
            return "Error en la ejecución de la orden.";
        }


    }





    if (type.toUpperCase() === 'SELL') {

        try {

            if (market.toUpperCase() === 'SPOT') {

                const ordenes = await movementsModel.find({ strategy: strategy, open: true, broker: 'binance' });

                if (ordenes.length > 0) {
                    for (let orden of ordenes) {

                        const order = await spot.newOrder(orden.epic, 'SELL', 'MARKET', { quantity: orden.size });
                        const fill = order.data.fills[0];

                        let ganancia = fill.price * fill.qty - orden.buyPrice;
                        await movementsModel.updateOne({ _id: orden._id }, { $set: { open: false, sellPrice: fill.price * fill.qty, ganancia: ganancia } });

                        // io.emit('dashboard_update', { type: type, strategy: strategy });

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
            console.error("Error de Binance:", JSON.stringify(error, null, 2));
            return "Error en la ejecución de la orden.";
        }

    }


}

export const positionSell = async (type: string, market: string, epic: string, leverage: number, quantity: number, strategy: string) => {


     if (type.toUpperCase() === 'SELL') {

        try {
            if (market.toUpperCase() === 'SPOT') {
                const order = await spot.newOrder(epic, 'SELL', 'MARKET', { quantity: quantity });

                const fill = order.data.fills[0];

                const movements = new movementsModel({
                    idRefBroker: order.data.orderId,
                    strategy: strategy,
                    market: market.toUpperCase(),
                    type: type,
                    margen: 0,
                    size: quantity,
                    epic: epic,
                    open: true,
                    buyPrice: fill.price * fill.qty,
                    sellPrice: 0,
                    ganancia: 0,
                    broker: 'binance',
                    date: new Date(),
                    myRegionalDate: new Date().setHours(new Date().getHours() - 5)
                })

                await movements.save();

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
            console.error("Error de Binance:", JSON.stringify(error, null, 2));
            return "Error en la ejecución de la orden.";
        }


    }





    if (type.toUpperCase() === 'BUY') {

        try {

            if (market.toUpperCase() === 'SPOT') {

                const ordenes = await movementsModel.find({ strategy: strategy, open: true, broker: 'binance' });

                if (ordenes.length > 0) {
                    for (let orden of ordenes) {

                        const order = await spot.newOrder(orden.epic, 'BUY', 'MARKET', { quantity: orden.size });
                        const fill = order.data.fills[0];

                        let ganancia = fill.price * fill.qty - orden.buyPrice;
                        await movementsModel.updateOne({ _id: orden._id }, { $set: { open: false, sellPrice: fill.price * fill.qty, ganancia: ganancia } });

                        // io.emit('dashboard_update', { type: type, strategy: strategy });

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
            console.error("Error de Binance:", JSON.stringify(error, null, 2));
            return "Error en la ejecución de la orden.";
        }

    }
}
