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
 * @returns {Promise<string | number | undefined>} El resultado de la función setposition.
 */
export const position = async (type: string, strategy: string) => {

    switch (type.toUpperCase()) {
        case 'BUY':
            try {

                const order = await binance.marketBuy("BTCUSDT", 0.001)

                const movements = new movementsModel({
                    idRefBroker: order.orderId,
                    strategy: strategy,
                    open: true,
                    broker: 'binance',
                    date: new Date(),
                    myRegionalDate: new Date().setHours(new Date().getHours() - 5)
                })

                let r1 = await movements.save();

                const newHistory = new HistoryModel({
                    idRefBroker: order.orderId,
                    event: 'buy',
                    movementRef: r1._id

                })

                await newHistory.save()


                return "Orden completada"

            }
            catch (e) {
                let asusnto = "error al generar la orden de binance, strategia:" + strategy;
                await errorSendEmail(asusnto ,e.mensaje)
                console.error(`❌ Error closing position ${e.message}:`)
                return "error al generar la orden"
            }
            break;

        case 'SELL':
            try {
                // Buscamos todas las órdenes de compra abiertas para la estrategia dada.
                const ordenes = await movementsModel.find({ strategy: strategy, open: true, broker: 'binance' });

                if (ordenes.length > 0) {
                    // Usamos reduce para sumarizar la cantidad a vender de forma más limpia.
                    const amountSell = ordenes.reduce((sum) => sum + 0.001, 0);

                    // Ejecutamos la orden de venta en el mercado.
                    const order = await binance.marketSell("BTCUSDT", amountSell);

                    // Preparamos los IDs de las órdenes que vamos a cerrar.
                    const idsToUpdate = ordenes.map(o => o._id);

                    // Creamos las promesas para actualizar la base de datos y registrar el historial.
                    const updatePromise = movementsModel.updateMany({ _id: { $in: idsToUpdate } }, { $set: { open: false } });
                    const historyPromise = new HistoryModel({
                        idRefBroker: order.orderId,
                        event: 'sell',
                        movementRef: idsToUpdate // Asumimos que movementRef puede guardar un array de IDs
                    }).save();

                    // Con Promise.all, esperamos a que ambas operaciones asíncronas terminen.
                    await Promise.all([updatePromise, historyPromise]);

                    return "Orden de venta completada y registros actualizados.";

                } else {
                    return "No hay órdenes abiertas para vender.";
                }
            } catch (e) {
                let asusnto = "Error al generar la orden de venta en Binance, estrategia:" + strategy;
                await errorSendEmail(asusnto ,e.mensaje)
                console.error(`❌ Error closing position ${e.message}:`);
                return "error al generar la orden de venta"
            }
            break;
    }

}