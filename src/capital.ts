/**
 * @file Módulo para interactuar con la API de Capital.com para gestionar sesiones, cuentas y posiciones de trading.
 */

import axios, { AxiosRequestConfig } from "axios";
import movementsModel from "./config/models/movements";
import { errorSendEmail } from "./config/mail";
import { getSession } from "./config/sessionManager";
import { Server } from "socket.io";
import cron from 'node-cron';
import { pre } from "@typegoose/typegoose";

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

export async function getprices(epic: string, size: number,) {
  const sesiondata = await getSession();

  const response = await axios.get(`${url_api}prices/${epic}`, {
    headers: {
      'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
      'CST': sesiondata.CST,
      'Content-Type': 'application/json',
    }
  });

  let crypto = ['BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD', 'BCHUSD', 'EOSUSD', 'XLMUSD', 'ADAUSD', 'TRXUSD', 'DOGEUSD']
  let coin = ['US100', 'US30', 'DE30', 'UK100', 'FR40', 'JP225', 'HK50', 'CN50']

  let margin = 1
  if (crypto.includes(epic)) { margin = 20 }
  if (coin.includes(epic)) { margin = 100 }

  let r = {
    precio: response.data.prices[0].openPrice.bid,
    size: size,
    margen: parseFloat(((response.data.prices[0].openPrice.bid * size) / margin).toFixed(2))
  }

  return r
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

  let crypto = ['BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD', 'BCHUSD', 'EOSUSD', 'XLMUSD', 'ADAUSD', 'TRXUSD', 'DOGEUSD']
  let coin = ['US100', 'US30', 'DE30', 'UK100', 'FR40', 'JP225', 'HK50', 'CN50']

  let activePositionslist = positionslist.data;
  let idref = ""
  if (activePositionslist.affectedDeals.length > 0) { idref = activePositionslist.affectedDeals[0].dealId }
  else { idref = activePositionslist.dealId }

  let margin = 1
  if (crypto.includes(activePositionslist.epic)) { margin = 20 }
  if (coin.includes(activePositionslist.epic)) { margin = 100 }

  let response = {
    buyprice: activePositionslist.level,
    id: activePositionslist.dealReference,
    idBroker: idref,
    status: activePositionslist.status,
    level: activePositionslist.level,
    margen: (activePositionslist.level * activePositionslist.size) / margin
  }
  return response
}

async function beforeDeletePosition(id: string, date: string, openPrice: number) {

  const sesiondata = await getSession();


  let f = new Date(date);
  const year = f.getUTCFullYear();
  const month = (f.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = f.getUTCDate().toString().padStart(2, '0');
  const h = f.getUTCHours().toString().padStart(2, '0');
  const m = f.getUTCMinutes().toString().padStart(2, '0');

  f.setUTCMinutes(f.getUTCMinutes() + 2);
  const newm = f.getUTCMinutes().toString().padStart(2, '0');
  let r = await axios.get(`${url_api}history/activity?from=${year}-${month}-${day}T${h}:${m}:00&to=${year}-${month}-${day}T${h}:${newm}:59&detailed=true`, {
    headers: {
      'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
      'CST': sesiondata.CST,
      'Content-Type': 'application/json',
    }
  })

  let activity = r.data.activities

  let g = 0;
  let sellPrice = 0;

  for (let position of activity) {
    if (position.type !== 'WORKING_ORDER' && position.details.workingOrderId) {
      if (position.details.workingOrderId === id || position.dealId === id) {
        switch (position.details.direction) {

          case ('BUY'):
            if (position.details.level !== 0) {
              g = (openPrice - position.details.level) * position.details.size
              sellPrice = position.details.level
            }
            break;
          case ('SELL'):
            if (position.details.level !== 0) {
              g = (position.details.level - openPrice) * position.details.size
              sellPrice = position.details.level
            }
        }

      }
    }

  }






  return {
    sellprice: sellPrice,
    ganancia: g
  }

}


/**
 * @async
 * @function accountBalance
 * @description Obtiene el balance de las cuentas del usuario autenticado en Capital.com.
 * @returns {Promise<object>} El balance de las cuentas del usuario.
 */
export const accountBalance = async () => {
  const sesiondata = await getSession();

  console.log(sesiondata)

  const accountBalance = await getAccountBalance(sesiondata.XSECURITYTOKEN, sesiondata.CST);
  console.log(accountBalance.accounts)
  return accountBalance.accounts;
}

/**
 * @async
 * @function singlePosition
 * @description Obtiene el nivel (precio) de una posición individual utilizando su referencia.
 * @param {string} reference - La referencia de la operación para obtener el nivel.
 * @returns {Promise<number | undefined>} El nivel de la posición o undefined si ocurre un error.
 */
export const singlePosition = async (id: string) => {
  try {
    const sesiondata = await getSession();
    let response = await axios.get(`${url_api}positions/${id}`, {
      headers: {
        'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
        'CST': sesiondata.CST,
        'Content-Type': 'application/json',
      }
    });

    let position = response.data.position
    return {
      sellprice: position.level,
      ganancia: position.upl
    }


  }
  catch (error: any) {
    console.error("Error fetching single position:", error.message);
    return;
  }
};




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
async function updateDbPositions(id: string, buyPrice: number, size: number, margen: number, sellPrice: number, ganancia: number, strategy: string, open: boolean, type: string, broker: string) {

  if (open) {
    let date = new Date()
    const newMovement = new movementsModel({
      idRefBroker: id,
      type: type.toUpperCase(),
      strategy: strategy,
      size: size,
      open: open,
      buyPrice: buyPrice,
      sellPrice: sellPrice,
      margen: margen,
      ganancia: ganancia,
      broker: broker,
      date: date.toISOString(),
      myRegionalDate: date.setHours(date.getHours() - 5)
    });

    await newMovement.save();

    return "creado y guardado";

  } else {
    const m = await movementsModel.find({ _id: id });
    await movementsModel.updateOne({ _id: id }, { open: open, type: type.toUpperCase(), sellPrice: sellPrice, ganancia: ganancia.toFixed(2) });
    return "cerrado";
  } // Should not reach here if open is true and m.length > 0, or if open is false
}

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

        await updateDbPositions(active.idBroker, active.buyprice, size, active.margen, 0, 0, strategy, true, type, 'capital');
        io.emit('update', { message: 'Nueva posición abierta de ' + strategy + ' en Capital.com' });
        return "posicion abierta";
      } catch (error: any) {
        console.error('❌ Error:', error.data);

        let mensaje = "error al realizar la compra en capital, estrategia:" + strategy
        await errorSendEmail(mensaje, error.response?.data || error.message)
        return "Error al realizar la compra";
      }

    case ('sell'):
      const m = await movementsModel.find({ strategy: strategy, open: true, broker: 'capital' }).sort({ myRegionalDate: -1 });
      let idref = ''
      if (m.length > 0) {
        for (const position of m) {
          try {

            idref = `error al realizar el delete en capital, id: ${position.idRefBroker}`;
            let response = await axios.delete(`${url_api}positions/${position.idRefBroker}`, {
              headers: {
                'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
                'CST': sesiondata.CST,
                'Content-Type': 'application/json',
              }
            });

            await new Promise(resolve => setTimeout(resolve, 60));

            let confirmPosition = await CloseConfirmation(response.data.dealReference)
            let newid = confirmPosition.affectedDeals[0].dealId !== position.idRefBroker ? confirmPosition.affectedDeals[0].dealId : position.idRefBroker

            let ganancia = 0
            let closeprice = 0

            if (confirmPosition.profit) {
              ganancia = confirmPosition.profit
              closeprice = confirmPosition.level
            }
            else {
              const finalPosition = await beforeDeletePosition(newid, position.date.toISOString(), position.buyPrice)
              ganancia = finalPosition.ganancia
              closeprice = finalPosition.sellprice
            }

            await updateDbPositions(position._id.toString(), 0, 0, 0, closeprice, ganancia, strategy, false, type, 'capital');
            io.emit('update', { message: 'posición cerrada de ' + strategy + ' en Capital.com' });
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

    await updateDbPositions(active.idBroker, active.buyprice, size, active.margen, 0, 0, strategy, true, type, 'capital');
    io.emit('update', { message: 'Nueva posición abierta de ' + strategy + ' en Capital.com' });
    return "posicion abierta";
  } catch (error: any) {
    console.error('❌ Error:', error.data);

    let mensaje = "error al realizar la compra en capital, estrategia:" + strategy
    await errorSendEmail(mensaje, error.data)
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

        let response = await axios.delete(`${url_api}positions/${position.idRefBroker}`, {
          headers: {
            'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
            'CST': sesiondata.CST,
            'Content-Type': 'application/json',
          }
        });


        await new Promise(resolve => setTimeout(resolve, 60));

        let confirmPosition = await CloseConfirmation(response.data.dealReference)
        let newid = confirmPosition.affectedDeals[0].dealId !== position.idRefBroker ? confirmPosition.affectedDeals[0].dealId : position.idRefBroker



        let ganancia = 0
        let closeprice = 0

        if (confirmPosition.profit) {
          ganancia = confirmPosition.profit
          closeprice = confirmPosition.level
        }
        else {
          const finalPosition = await beforeDeletePosition(newid, position.date.toISOString(), position.buyPrice)
          ganancia = finalPosition.ganancia
          closeprice = finalPosition.sellprice
        }


        await updateDbPositions(position._id.toString(), 0, 0, 0, closeprice, ganancia, strategy, false, type, 'capital');
        io.emit('update', { message: 'posición cerrada de ' + strategy + ' en Capital.com' });
      } catch (error: any) {
        console.log("error capitalbuyandsell ==> ", error.data)
        let mensaje = "error al realizar el cierre en capital, estrategia:" + strategy
        // await errorSendEmail(mensaje, error.response?.data || error.message)
        // await idrefVerification(position.idRefBroker, strategy)
        return "Error al cerrar la posición";
      }
    }
    return "posiciones cerradas";
  }
}

export async function verifyAndClosePositions() {
  const sesiondata = await getSession();

  let m = await movementsModel.find({ open: true, broker: 'capital' }).sort({ myRegionalDate: -1 });
  let r = await axios.get(`${url_api}positions`, {
    headers: {
      'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
      'CST': sesiondata.CST,
      'Content-Type': 'application/json',
    }
  });

  let openPositions = r.data.positions;

  for (const position of m) {
    let exists = openPositions.find((p: any) => p.position.dealId === position.idRefBroker);
    if (!exists) {
      const finalPosition = await beforeDeletePosition(position.idRefBroker, position.date.toISOString(), position.buyPrice)


      await updateDbPositions(position._id.toString(), 0, 0, 0, finalPosition.sellprice, finalPosition.ganancia, position.strategy, false, position.type, 'capital');
      console.log(`Cerrada posición ${position.idRefBroker} en la base de datos porque no existe en Capital.com`);
    }
  }

  return "todas las posiciones verificadas";

}

async function CloseConfirmation(ref: string) {
  const sesiondata = await getSession();

  let r = await axios.get(`${url_api}confirms/${ref}`, {
    headers: {
      'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
      'CST': sesiondata.CST,
      'Content-Type': 'application/json',
    }
  })
  let response = r.data
  return response

}


cron.schedule('*/5 * * * *', async () => {
  return await verifyAndClosePositions();
})