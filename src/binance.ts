/**
 * @file Módulo para interactuar con la API de Binance para realizar operaciones de trading.
 */

import axios, { AxiosRequestConfig } from "axios"
import Binance from 'node-binance-api';
import dotenv from 'dotenv';
dotenv.config();

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
 * @function setposition
 * @description Coloca una orden de compra o venta en Binance.
 * @param {string} side - El tipo de orden a ejecutar ('BUY' o 'SELL').
 * @param {number} price - El precio al cual ejecutar la orden (para órdenes de límite).
 * @returns {Promise<string | number>} Una promesa que se resuelve con un mensaje de éxito o un código de error 500.
 */
async function setposition(side: string, price: number) {
    let order: string = "0"
    let balance: Balances = await binance.balance()

    try {
        switch (side.toUpperCase()) {
            case 'BUY':
                let order1 = await binance.order('LIMIT', 'BUY', 'BTCUSDT', 0.001, price)
                console.log('orden nueva =>', order1)

                let newbalance: Balances = await binance.balance();
                console.log(newbalance.BTC)

                return "compra hecha con exito"

            case 'SELL':
                if (balance.BTC !== undefined) {
                    const sellOrder = await binance.marketSell("BTCUSDT", parseFloat(balance.BTC.available));
                    console.log(sellOrder)
                    let newbalance: Balances = await binance.balance();
                    console.log(newbalance.BTC)

                    return "cierre de posiciones completado"
                }
                break;
        }

        return order
    } catch (err) {
        console.error("Error creando Stop-Market:", err);
        return 500
    }
}

/**
 * @async
 * @function position
 * @description Obtiene el precio actual de BTCUSDT y ejecuta una orden de compra o venta.
 * @param {string} type - El tipo de operación a realizar ('BUY' o 'SELL').
 * @returns {Promise<string | number | undefined>} El resultado de la función setposition.
 */
export const position = async (type: string) => {
    let price = await binance.prices('BTCUSDT')
    console.log(price.BTCUSDT)

    if (price.BTCUSDT !== undefined) {
        return setposition(type, price.BTCUSDT)
    }
}
