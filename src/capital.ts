/**
 * @file Módulo para interactuar con la API de Capital.com para gestionar sesiones, cuentas y posiciones de trading.
 */

import axios, { AxiosRequestConfig } from "axios";
import dotenv from 'dotenv';
dotenv.config();

import movementsModel from "./config/models/movements";
import HistoryModel from "./config/models/history";
import { errorSendEmail } from "./config/mail";

// Constantes para la configuración de la API de Capital.com
const API_KEY = process.env.Capital_ApiKey;
const capitalPassword = process.env.Capital_Password;
const url_api = 'https://demo-api-capital.backend-capital.com/api/v1/';
const identifier = process.env.Capital_identifier;

/**
 * @async
 * @function login
 * @description Inicia sesión en la API de Capital.com para obtener los tokens de sesión.
 * @returns {Promise<object>} Un objeto que contiene los tokens CST y X-SECURITY-TOKEN.
 */
async function login() {
  const headers = {
    'X-CAP-API-KEY': API_KEY,
    'Content-Type': 'application/json',
  };

  const body = {
    identifier: identifier,
    password: capitalPassword,
    encryptedPassword: false
  };

  const response = await axios.post(
    `${url_api}session`,
    body,
    { headers }
  );

  let responseDataCapital = {
    "CST": response.headers.cst,
    "XSECURITYTOKEN": response.headers['x-security-token']
  }
  return responseDataCapital;
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
  return activePositionslist[activePositionslist.length - 1].position.dealId;
}

/**
 * @async
 * @function accountBalance
 * @description Exporta una función que obtiene y devuelve el balance de las cuentas.
 * @returns {Promise<object>} El balance de las cuentas.
 */
export const accountBalance = async () => {
  const sesiondata = await login();
  const accountBalance = await getAccountBalance(sesiondata.XSECURITYTOKEN, sesiondata.CST);
  return accountBalance.accounts;
}

/**
 * @async
 * @function positions
 * @description Abre o cierra posiciones en Capital.com y actualiza la base de datos.
 * @param {string} epic - El identificador del instrumento (ej. 'BTCUSD').
 * @param {number} size - El tamaño de la posición.
 * @param {string} type - El tipo de operación ('buy' o 'sell').
 * @param {string} strategy - La estrategia asociada a la posición.
 * @returns {Promise<string | undefined>} Un mensaje indicando el resultado de la operación.
 */
export const positions = async (epic: string, size: number, type: string, strategy: string) => {
  const sesiondata = await login();
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
        const idactive: any = await allActivePositions(sesiondata.XSECURITYTOKEN, sesiondata.CST);
        await updateDbPositions(idactive, strategy, true, 'capital');
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
            await axios.delete(`${url_api}positions/${position.idRefBroker}`, {
              headers: {
                'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
                'CST': sesiondata.CST,
                'Content-Type': 'application/json',
              }
            });
            await updateDbPositions(position.idRefBroker, strategy, false, 'capital');
            await new Promise(resolve => setTimeout(resolve, 1000));
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
 * @description Crea o actualiza un registro de posición en la base de datos.
 * @param {string} id - El ID de referencia del broker para la posición.
 * @param {string} strategy - La estrategia asociada.
 * @param {boolean} open - El estado de la posición (abierta o cerrada).
 * @param {string} broker - El nombre del broker ('capital').
 * @returns {Promise<string>} Un mensaje indicando si la posición fue creada o cerrada en la BD.
 */
async function updateDbPositions(id: string, strategy: string, open: boolean, broker: string) {
  if (open) {

    const m = await movementsModel.find({ idRefBroker: id });
    if (m.length === 0) {

      let date = new Date()
      const newMovement = new movementsModel({
        idRefBroker: id,
        strategy: strategy,
        open: open,
        broker: broker,
        date: date,
        myRegionalDate: date.setHours(date.getHours() - 5)
      });
      let r1 = await newMovement.save();

      const newHistory = new HistoryModel({
        idRefBroker: id,
        event: 'buy',
        movementRef: r1._id
      })


      await newHistory.save();

      return "creado y guardado";
    }
  } else {
    await movementsModel.updateOne({ idRefBroker: id }, { open: open });

    let movent = await movementsModel.findOne({ idRefBroker: id });

    const newHistory = new HistoryModel({
      idRefBroker: id,
      event: 'sell',
      movementRef: movent._id
    })

    await newHistory.save();
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