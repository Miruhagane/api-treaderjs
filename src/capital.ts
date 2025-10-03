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

/**
 * @async
 * @function getAccountBalance
 * @description Obtiene el balance de la cuenta de Capital.com.
 * @param {string} token - El token de seguridad (X-SECURITY-TOKEN) para la autenticación.
 * @param {string} cst - El token CST para la autenticación.
 * @returns {Promise<object>} Los datos del balance de la cuenta, incluyendo información de las cuentas.
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
 * @description Obtiene los detalles de una posición activa específica utilizando su ID de referencia.
 * @param {string} XSECURITYTOKEN - El token de seguridad (X-SECURITY-TOKEN) para la autenticación.
 * @param {string} CST - El token CST para la autenticación.
 * @param {string} id - El ID de referencia de la posición a buscar.
 * @returns {Promise<{buyprice: number, id: string}>} Un objeto con el precio de compra y el ID de la posición.
 */
async function allActivePositions(XSECURITYTOKEN: string, CST: string, id: string) {

  const positionslist = await axios.get(`${url_api}confirms/${id}`, {
    headers: {
      'X-SECURITY-TOKEN': XSECURITYTOKEN,
      'CST': CST,
      'Content-Type': 'application/json',
    }
  });

  let activePositionslist = positionslist.data;

console.log(activePositionslist)
  let idref = ""
  if (activePositionslist.affectedDeals.length > 0) { idref = activePositionslist.affectedDeals[0].dealId }
  else { idref = activePositionslist.dealId }

  let response = {
    buyprice: activePositionslist.level,
    id: activePositionslist.dealReference,
    idBroker: idref,
    status: activePositionslist.status,
    level: activePositionslist.level
  }

  return response
}

/**
 * @async
 * @function accountBalance
 * @description Obtiene el balance de las cuentas del usuario autenticado en Capital.com.
 * @returns {Promise<object>} El balance de las cuentas del usuario.
 */
export const accountBalance = async () => {
  const sesiondata = await getSession();
  const accountBalance = await getAccountBalance(sesiondata.XSECURITYTOKEN, sesiondata.CST);
  return accountBalance.accounts;
}

/**
 * @async
 * @function singlePosition
 * @description Obtiene el nivel (precio) de una posición individual utilizando su referencia.
 * @param {string} reference - La referencia de la operación para obtener el nivel.
 * @returns {Promise<number | undefined>} El nivel de la posición o undefined si ocurre un error.
 */
export const singlePosition = async (reference: string) => {
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
    console.error("Error fetching single position:", error.message);
    return undefined;
  }
};

/**
 * @async
 * @function positions
 * @description Abre o cierra posiciones en Capital.com y actualiza la base de datos de movimientos.
 * @param {string} epic - El identificador del instrumento (ej. 'BTCUSD').
 * @param {number} size - El tamaño de la posición a abrir o cerrar.
 * @param {string} type - El tipo de operación ('buy' para compra, 'sell' para venta).
 * @param {string} strategy - La estrategia asociada a la posición.
 * @param {Server} io - Instancia del servidor Socket.IO para emitir actualizaciones del dashboard.
 * @returns {Promise<string | undefined>} Un mensaje indicando el resultado de la operación o undefined en caso de error.
 */
export const positions = async (epic: string, size: number, type: string, strategy: string, io: Server) => {
  const sesiondata = await getSession();
  switch (type) {
    case ('buy'):
      await new Promise(resolve => setTimeout(resolve, 1000));
      const payloadCompra = {
        epic,
        direction: type.toUpperCase(),
        size: size.toString(),
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
        let r = await axios(options);

        const active: any = await allActivePositions(sesiondata.XSECURITYTOKEN, sesiondata.CST, r.data.dealReference);

        await updateDbPositions(active.id, active.buyprice, size, 0, 0, strategy, true, type, 'capital', io);
        return "posicion abierta";
      } catch (error: any) {
        console.error('❌ Error:', error.response?.data || error.message);

        let mensaje = "error al realizar la compra en capital, estrategia:" + strategy
        await errorSendEmail(mensaje, error.response?.data || error.message)
        return "Error al realizar la compra";
      }

    case ('sell'):
      const m = await movementsModel.find({ strategy: strategy, open: true, broker: 'capital' }).sort({ myRegionalDate: -1 });
      let idref = ''
      if (m.length > 0) {
        let close = false;
        for (const position of m) {
          try {

            const active: any = await allActivePositions(sesiondata.XSECURITYTOKEN, sesiondata.CST, position.idRefBroker);
            idref = `error al realizar el delete en capital, id: ${active.idBroker}`;
            let response = await axios.delete(`${url_api}positions/${active.idBroker}`, {
              headers: {
                'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
                'CST': sesiondata.CST,
                'Content-Type': 'application/json',
              }
            });

            const ver: any = await allActivePositions(sesiondata.XSECURITYTOKEN, sesiondata.CST, response.data.dealReference);

            await updateDbPositions(position.idRefBroker, 0, 0, ver.level, 0, strategy, false, type, 'capital', io);
          } catch (error: any) {
            console.log(error.data)
            console.error(`❌ Error closing position ${position.idRefBroker}:`, idref);
            let mensaje = "error al realizar el cierre en capital, estrategia:" + strategy
            // await errorSendEmail(mensaje, error.response?.data || error.message)
            // await idrefVerification(position.idRefBroker, strategy)

            return "Error al cerrar la posición";
          }
        }
      }
      return "posiciones cerradas";
  }
  return undefined; // Should not reach here if type is 'buy' or 'sell'
}


/**
 * @async
 * @function updateDbPositions
 * @description Crea o actualiza un registro de posición en la base de datos de movimientos y emite una actualización del dashboard.
 * @param {string} id - El ID de referencia del broker para la posición.
 * @param {number} buyPrice - El precio de compra de la posición.
 * @param {number} sellPrice - El precio de venta de la posición.
 * @param {number} ganancia - La ganancia obtenida de la posición.
 * @param {string} strategy - La estrategia asociada.
 * @param {boolean} open - El estado de la posición (true para abierta, false para cerrada).
 * @param {string} broker - El nombre del broker ('capital').
 * @param {Server} io - Instancia del servidor Socket.IO para emitir actualizaciones del dashboard.
 * @returns {Promise<string>} Un mensaje indicando si la posición fue creada o cerrada en la BD.
 */
/**
 * @async
 * @function updateDbPositions
 * @description Crea o actualiza un registro de posición en la base de datos de movimientos y emite una actualización del dashboard.
 * @param {string} id - El ID de referencia del broker para la posición.
 * @param {number} buyPrice - El precio de compra de la posición.
 * @param {number} sellPrice - El precio de venta de la posición.
 * @param {number} ganancia - La ganancia obtenida de la posición.
 * @param {string} strategy - La estrategia asociada.
 * @param {boolean} open - El estado de la posición (true para abierta, false para cerrada).
 * @param {string} broker - El nombre del broker ('capital').
 * @param {Server} io - Instancia del servidor Socket.IO para emitir actualizaciones del dashboard.
 * @returns {Promise<string>} Un mensaje indicando si la posición fue creada o cerrada en la BD.
 */
async function updateDbPositions(id: string, buyPrice: number, size: number, sellPrice: number, ganancia: number, strategy: string, open: boolean, type: string, broker: string, io: Server) {
  const m = await movementsModel.find({ idRefBroker: id });
  if (open) {
    if (m.length === 0) {

      let date = new Date()
      const newMovement = new movementsModel({
        idRefBroker: id,
        type: type.toUpperCase(),
        strategy: strategy,
        size: size,
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

    let strategyS = ["Enhanced MACD", "crybaby"]

    let size = 0.01

    if (strategyS.includes(strategy) !== true) {
      size = 0.001
    }
    let ganancia = (sellPrice - m[0].buyPrice) * m[0].size;
     await movementsModel.updateOne({ idRefBroker: id }, { open: open, type: type.toUpperCase(), sellPrice: sellPrice, ganancia: ganancia });
    io.emit('dashboard_update', { type: 'sell', strategy: strategy });
    return "cerrado";
  }
  return "No se realizó ninguna acción"; // Should not reach here if open is true and m.length > 0, or if open is false
}

/**
 * @async
 * @function idrefVerification
 * @description Intenta verificar y corregir el estado de una posición en caso de error al cerrar una operación en Capital.com.
 *              Busca posiciones abiertas en Capital.com que no coincidan con el ID de referencia y las cierra, actualizando la base de datos.
 * @param {string} id - El ID de referencia de la posición que falló al cerrar.
 * @param {string} strategy - La estrategia asociada a la posición.
 * @returns {Promise<string | undefined>} Un mensaje indicando si se corrigió el error o undefined en caso de fallo.
 */
export async function idrefVerification(id: string, strategy: string) {

  try {
    const sesiondata = await getSession();
    let epic = "US100";
    let strategyS = ["Enhanced MACD", "crybaby"]

    strategyS.includes(strategy) ? null : epic = "BTCUSD"

    let posicionError = await movementsModel.find({ idRefBroker: id, strategy: strategy });

    let positionslist = await axios.get(`${url_api}positions/`, {
      headers: {
        'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
        'CST': sesiondata.CST,
        'Content-Type': 'application/json',
      }
    })


    for (let position of positionslist.data.positions) {

      if (position.position.dealId !== id && position.market.epic === epic) {
        let response = await axios.delete(`${url_api}positions/${position.position.dealId}`, {
          headers: {
            'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
            'CST': sesiondata.CST,
            'Content-Type': 'application/json',
          }
        });
        let singlePositionR = await singlePosition(response.data.dealReference);
        let ganancia = (singlePositionR - posicionError[0].buyPrice) * posicionError[0].size;
        await movementsModel.updateOne({ _id: posicionError[0]._id }, { open: false, idRefBroker: position.position.dealId, sellPrice: singlePositionR, ganancia: ganancia })
        console.info(`error corregido nuevo idref: ${position.position.dealId}`)
        return `error corregido nuevo idref: ${position.position.dealId}`
      }
    }
  }
  catch (e: any) {
    console.error("error al reinterntar el cierre en capital estrategia:" + strategy + " id:" + id);
    let asunto = "error al reintentar el cierre en capital, estrategia:" + strategy
    let mensaje = `id: ${id}`

    await errorSendEmail(asunto, mensaje)
  }
  return undefined;
}

async function capitalPosition(epic: string, size: number, type: string, strategy: string, io: Server) {
  const sesiondata = await getSession();
  await new Promise(resolve => setTimeout(resolve, 1000));
  const payloadCompra = {
    epic,
    direction: type.toUpperCase(),
    size: size.toString(),
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
    let r = await axios(options);

    const active: any = await allActivePositions(sesiondata.XSECURITYTOKEN, sesiondata.CST, r.data.dealReference);

    await updateDbPositions(active.id, active.buyprice, size, 0, 0, strategy, true, type, 'capital', io);
    return "posicion abierta";
  } catch (error: any) {
    console.error('❌ Error:', error.response?.data || error.message);

    let mensaje = "error al realizar la compra en capital, estrategia:" + strategy
    await errorSendEmail(mensaje, error.response?.data || error.message)
    return "Error al realizar la compra";
  }
}


export async function capitalbuyandsell(epic: string, size: number, type: string, strategy: string, io: Server) {


  let m = await movementsModel.find({ strategy: strategy, open: true, broker: 'capital' }).sort({ myRegionalDate: -1 });


  if (m.length === 0) {
    return await capitalPosition(epic, size, type, strategy, io)
  }

  if (m[0]?.type === type.toUpperCase()) {
    return await capitalPosition(epic, size, type, strategy, io)
  }

  if (m[0]?.type !== type.toUpperCase()) {
    const sesiondata = await getSession();
    for (const position of m) {
      try {
        const active: any = await allActivePositions(sesiondata.XSECURITYTOKEN, sesiondata.CST, position.idRefBroker);

        console.log(active)

        let response = await axios.delete(`${url_api}positions/${active.idBroker}`, {
              headers: {
                'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
                'CST': sesiondata.CST,
                'Content-Type': 'application/json',
              }
            });

            
        const ver: any = await allActivePositions(sesiondata.XSECURITYTOKEN, sesiondata.CST, response.data.dealReference);

        await updateDbPositions(position.idRefBroker, 0, 0, ver.level, 0, strategy, false, type, 'capital', io);
      } catch (error: any) {
        console.log("error capitalbuyandsell ==> ",error.errorCode)
        let mensaje = "error al realizar el cierre en capital, estrategia:" + strategy
        // await errorSendEmail(mensaje, error.response?.data || error.message)
        // await idrefVerification(position.idRefBroker, strategy)

        return "Error al cerrar la posición";
      }
    }
    return "posiciones cerradas";
  }


}