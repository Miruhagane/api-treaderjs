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

// Inicializa el cliente de Binance con las claves de API desde las variables de entorno.
const binance = new Binance({
    APIKEY: process.env.Binance_ApiKey,
    APISECRET: process.env.Binance_ApiSecret,
    test: true
});

/**
 * @async
 * @function position
 * @description Obtiene el precio actual de BTCUSDT y ejecuta una orden de compra o venta.
 * @param {string} type - El tipo de operación a realizar ('BUY' o 'SELL').
 * @param {string} strategy - La estrategia asociada a la posición.
 * @param {Server} io - Instancia del servidor Socket.IO.
 * @returns {Promise<string | number | undefined>} El resultado de la función setposition.
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