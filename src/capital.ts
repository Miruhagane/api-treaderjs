/**
 * @file Módulo para interactuar con la API de Capital.com para gestionar sesiones, cuentas y posiciones de trading.
 */

import axios, { AxiosRequestConfig } from "axios";
import movementsModel from "./config/models/movements";
import { errorSendEmail } from "./config/mail";
import { getSession } from "./config/sessionManager";
import { Server } from "socket.io";
import { dashboard } from "./config/db/dashboard";

const url_api = 'https://demo-api-capital.backend-capital.com/api/v1/';

export async function active() {
  const sesiondata = await getSession();
  return await allActivePositions(sesiondata.XSECURITYTOKEN, sesiondata.CST);
}

/**
 * @async
 * @function getAccountBalance
 * @description Obtiene el balance de la cuenta de Capital.com.
 * @param {string} token - El token de seguridad (X-SECURITY-TOKEN).
 * @param {string} cst - El token CST.
 * @returns {Promise<object>} Los datos del balance de la cuenta.
 */
async function getAccountBalance(token: string, cst: string) {
  const response = await axios.get(`${url_api}accounts`, {
    headers: {
      'X-SECURITY-TOKEN': token,
      'CST': cst,
      'Content-Type': 'application/json',
    }
  });

  return response.data;
}

/**
 * @async
 * @function allActivePositions
 * @description Obtiene todas las posiciones activas y devuelve el ID de la última posición.
 * @param {string} XSECURITYTOKEN - El token de seguridad.
 * @param {string} CST - El token CST.
 * @returns {Promise<string>} El ID de la última posición activa.
 */
async function allActivePositions(XSECURITYTOKEN: string, CST: string) {
  const positionslist = await axios.get(`${url_api}positions`, {
    headers: {
      'X-SECURITY-TOKEN': XSECURITYTOKEN,
      'CST': CST,
      'Content-Type': 'application/json',
    }
  });

  let activePositionslist = positionslist.data.positions;

  let response = {
    buyprice: activePositionslist[activePositionslist.length - 1].position.level * 0.01,
    id: activePositionslist[activePositionslist.length - 1].position.dealId
  }

  return response
}

/**
 * @async
 * @function accountBalance
 * @description Exporta una función que obtiene y devuelve el balance de las cuentas.
 * @returns {Promise<object>} El balance de las cuentas.
 */
export const accountBalance = async () => {
  const sesiondata = await getSession();
  const accountBalance = await getAccountBalance(sesiondata.XSECURITYTOKEN, sesiondata.CST);
  return accountBalance.accounts;
}


export const singlePosition = async (reference: string) => {
  console.log("consultando posicion", reference)
  try {
    const sesiondata = await getSession();
    let response = await axios.get(`${url_api}confirms/${reference}`, {
      headers: {
        'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
        'CST': sesiondata.CST,
        'Content-Type': 'application/json',
      }
    });
    return response.data.level;
  }
  catch (error: any) {

  }
};

/**
 * @async
 * @function positions
 * @description Abre o cierra posiciones en Capital.com y actualiza la base de datos.
 * @param {string} epic - El identificador del instrumento (ej. 'BTCUSD').
 * @param {number} size - El tamaño de la posición.
 * @param {string} type - El tipo de operación ('buy' o 'sell').
 * @param {string} strategy - La estrategia asociada a la posición.
 * @param {Server} io - Instancia del servidor Socket.IO.
 * @returns {Promise<string | undefined>} Un mensaje indicando el resultado de la operación.
 */
export const positions = async (epic: string, size: number, type: string, strategy: string, io: Server) => {
  const sesiondata = await getSession();
  switch (type) {
    case ('buy'):
      await new Promise(resolve => setTimeout(resolve, 1000));
      const payloadCompra = {
        epic,
        direction: type.toUpperCase(),
        size: 0.01,
        orderType: 'MARKET',
        currencyCode: 'USD',
      };

      const options: AxiosRequestConfig = {
        method: 'POST',
        url: `${url_api}positions`,
        headers: {
          'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
          'CST': sesiondata.CST,
          'Content-Type': 'application/json',
        },
        data: payloadCompra
      };

      try {
        await axios(options);

        const active: any = await allActivePositions(sesiondata.XSECURITYTOKEN, sesiondata.CST);
        await updateDbPositions(active.id, active.buyprice, 0, 0, strategy, true, 'capital', io);
        return "posicion abierta";
      } catch (error: any) {
        console.error('❌ Error:', error.response?.data || error.message);

        let mensaje = "error al realizar la compra en capital, estrategia:" + strategy
        await errorSendEmail(mensaje, error.response?.data || error.message)
        return "Error al realizar la compra";
      }

    case ('sell'):
      const m = await movementsModel.find({ strategy: strategy, open: true, broker: 'capital' });
      if (m.length > 0) {
        for (const position of m) {
          try {

            let response = await axios.delete(`${url_api}positions/${position.idRefBroker}`, {
              headers: {
                'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
                'CST': sesiondata.CST,
                'Content-Type': 'application/json',
              }
            });

            let singlePositionR = await singlePosition(response.data.dealReference);
            console.log(singlePositionR)
            await updateDbPositions(position.idRefBroker, 0, singlePositionR, 0, strategy, false, 'capital', io);
          } catch (error: any) {
            console.error(`❌ Error closing position ${position.idRefBroker}:`, error.response?.data || error.message);
            let mensaje = "error al realizar la compra en capital, estrategia:" + strategy
            await errorSendEmail(mensaje, error.response?.data || error.message)
          }
        }
      }
      return "posiciones cerradas";
  }
}

/**
 * @async
 * @function updateDbPositions
 * @description Crea o actualiza un registro de posición en la base de datos y emite una actualización del dashboard.
 * @param {string} id - El ID de referencia del broker para la posición.
 * @param {string} strategy - La estrategia asociada.
 * @param {boolean} open - El estado de la posición (abierta o cerrada).
 * @param {string} broker - El nombre del broker ('capital').
 * @param {Server} io - Instancia del servidor Socket.IO.
 * @returns {Promise<string>} Un mensaje indicando si la posición fue creada o cerrada en la BD.
 */
async function updateDbPositions(id: string, buyPrice: number, sellPrice: number, ganancia: number, strategy: string, open: boolean, broker: string, io: Server) {
  const m = await movementsModel.find({ idRefBroker: id });
  if (open) {
    if (m.length === 0) {

      let date = new Date()
      const newMovement = new movementsModel({
        idRefBroker: id,
        strategy: strategy,
        open: open,
        buyPrice: buyPrice,
        sellPrice: sellPrice,
        ganancia: ganancia,
        broker: broker,
        date: date,
        myRegionalDate: date.setHours(date.getHours() - 5)
      });

      await newMovement.save();


      io.emit('dashboard_update', { type: 'buy', strategy: strategy });

      return "creado y guardado";
    }
  } else {
    let ganancia = (sellPrice * 0.001) - m[0].buyPrice;
    await movementsModel.updateOne({ idRefBroker: id }, { open: open, sellPrice: (sellPrice * 0.001), ganancia: ganancia });

    io.emit('dashboard_update', { type: 'sell', strategy: strategy });
    return "cerrado";
  }
}

/**
 * @function venta
 * @description Función de marcador de posición para una operación de venta. Parece estar incompleta.
 * @returns {object} Un objeto con un mensaje de éxito estático.
 */
export const venta = () => {
  return {
    status: 'success',
    message: 'compra Realizada con exito',
    timeStamp: new Date()
  }
}