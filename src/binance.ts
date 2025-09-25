/**
 * @file Módulo para interactuar con la API de Binance para realizar operaciones de trading.
 */

import axios, { AxiosRequestConfig } from "axios"
import Binance from 'node-binance-api';
import dotenv from 'dotenv';
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
/**
 * Inicializa el cliente de Binance con las claves de API y secretos desde las variables de entorno.
 * Configurado para usar el entorno de prueba (testnet).
 */
const binance = new Binance({
    APIKEY: process.env.Binance_ApiKey,
    APISECRET: process.env.Binance_ApiSecret,
    test: true
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
export const position = async (type: string, strategy: string, io: Server) => {

    console.log(type, strategy);

    switch (type.toUpperCase()) {
        case 'BUY':
            try {

                const order = await binance.marketBuy("BTCUSDT", 0, { quoteOrderQty: 5 });

                let qty = parseFloat(order.fills[0].qty);
                let price = parseFloat(order.fills[0].price);


                const movements = new movementsModel({
                    idRefBroker: order.orderId,
                    strategy: strategy,
                    open: true,
                    buyPrice: price * qty,
                    sellPrice: 0,
                    ganancia: 0,
                    broker: 'binance',
                    date: new Date(),
                    myRegionalDate: new Date().setHours(new Date().getHours() - 5)
                })

                await movements.save();

                io.emit('dashboard_update', { type: type, strategy: strategy });

                return " Orden de compra ejecutada y registrada en la base de datos."

            }
            catch (e) {
                let asusnto = "error al generar la orden de binance, strategia:" + strategy;
                await errorSendEmail(asusnto, e.mensaje)
                console.error(`❌ Error closing position ${e.message}:`)
                return "error al generar la orden"
            }
            break;

        case 'SELL':
            try {


                // Buscamos todas las órdenes de compra abiertas para la estrategia dada.
                const ordenes = await movementsModel.find({ strategy: strategy, open: true, broker: 'binance' });

                if (ordenes.length > 0) {


                    for (let orden of ordenes) {

                        const order = await binance.marketSell("BTCUSDT", 0, { quoteOrderQty: 5 });
                        let qty = parseFloat(order.fills[0].qty);
                        let price = parseFloat(order.fills[0].price);
                        let sellPrice = price * qty;

                        let ganancia = (sellPrice - orden.buyPrice) * 0.998;
                        let updatePromise = await movementsModel.updateOne({ _id: orden._id }, { $set: { open: false, sellPrice: sellPrice, ganancia: ganancia } });
                        console.log(updatePromise);


                    }

                    io.emit('dashboard_update', { type: type, strategy: strategy });
                    return "Orden de venta completada y registros actualizados.";

                } else {
                    return "No hay órdenes abiertas para vender.";
                }
            } catch (e) {
                let asusnto = "Error al generar la orden de venta en Binance, estrategia:" + strategy;
                await errorSendEmail(asusnto, e.mensaje)
                console.error(`❌ Error closing position ${e.message}:`);
                return "error al generar la orden de venta"
            }
            break;
    }

}