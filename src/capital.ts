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

// --- Infraestructura de la Cola de Peticiones Genérica ---

// Interfaz para definir una tarea genérica en la cola
interface Task {
  description: string;
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

// La cola de tareas
const requestQueue: Task[] = [];

// Bandera para saber si la cola se está procesando
let isProcessing = false;

// Función para procesar las tareas de la cola una por una
async function processQueue() {
  if (requestQueue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const task = requestQueue.shift();

  if (task) {
    console.log(`Processing task: ${task.description}`);
    try {
      const result = await task.execute();
      task.resolve(result);
    } catch (error) {
      console.error(`Error processing task: ${task.description}`, error);
      task.reject(error);
    }
  }

  // Llama recursivamente para la siguiente tarea
  processQueue();
}

// --- Fin de la Infraestructura de la Cola ---

const url_api = 'https://demo-api-capital.backend-capital.com/api/v1/';

// ... (funciones existentes como getAccountBalance, getprices, etc. se mantienen igual)
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
    
    let r = await axios.get(`${url_api}history/activity?from=${year}-${month}-${day}T00:00:00&to=${year}-${month}-${day}T23:59:59&detailed=true`, {
      headers: {
        'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
        'CST': sesiondata.CST,
        'Content-Type': 'application/json',
      }
    })
  
    let activity = r.data.activities
  
    let g = 0;
    let sellPrice = 0;
    let openprice = openPrice;
  
    for (let position of activity) {
      if (position.type !== 'WORKING_ORDER' && position.details.workingOrderId) {
        if (position.details.workingOrderId === id || position.dealId === id) {
          switch (position.details.direction) {
  
            case ('BUY'):
              if (position.details.level !== 0) {
                if (position.details.openPrice) { openprice = position.details.openPrice }
                g = (openprice - position.details.level) * position.details.size
                sellPrice = position.details.level
              }
              break;
            case ('SELL'):
              if (position.details.level !== 0) {
                if (position.details.openPrice) { openprice = position.details.openPrice }
                g = (position.details.level - openprice) * position.details.size
                sellPrice = position.details.level
              }
          }
  
        }
      }
  
    }
  
  console.log(openPrice, sellPrice, g)
  
    return {
      sellprice: sellPrice,
      ganancia: g,
      openprice: openprice
    }
  
  }
  
  export const accountBalance = async () => {
    const sesiondata = await getSession();
    const accountBalance = await getAccountBalance(sesiondata.XSECURITYTOKEN, sesiondata.CST);
    return accountBalance.accounts;
  }
  
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
      await movementsModel.updateOne({ _id: id }, { open: open, type: type.toUpperCase(), sellPrice: sellPrice, ganancia: ganancia.toFixed(2) });
      return "cerrado";
    }
  }

// --- Lógica de Trading Encolada ---

/**
 * @description (Añade a la cola) Abre o cierra una posición simple.
 */
export const positions = (epic: string, size: number, type: 'buy' | 'sell', strategy: string, io: Server): Promise<string | undefined> => {
  return new Promise((resolve, reject) => {
    const task: Task = {
      description: `position: ${type} ${size} ${epic}`,
      execute: () => _executePosition(epic, size, type, strategy, io),
      resolve,
      reject,
    };
    requestQueue.push(task);
    if (!isProcessing) {
      processQueue();
    }
  });
}

/**
 * @description (Añade a la cola) Lógica de trading compleja: cierra posiciones opuestas y abre una nueva.
 */
export const capitalbuyandsell = (epic: string, size: number, type: string, strategy: string, io: Server): Promise<string | undefined> => {
    return new Promise((resolve, reject) => {
      const task: Task = {
        description: `capitalbuyandsell: ${type} ${size} ${epic}`,
        execute: () => _capitalbuyandsell(epic, size, type, strategy, io),
        resolve,
        reject,
      };
      requestQueue.push(task);
      if (!isProcessing) {
        processQueue();
      }
    });
  }

/**
 * @description (Lógica interna) Ejecuta la apertura o cierre de una posición.
 */
async function _executePosition(epic: string, size: number, type: string, strategy: string, io: Server) {
    // ... (la lógica de la antigua función positions está aquí)
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
          console.error('❌ Error:', error);
          let mensaje = "error al realizar la compra en capital, estrategia:" + strategy
          await errorSendEmail(mensaje, error.response?.data || error.message)
          return "Error al realizar la compra";
        }
  
      case ('sell'):
        const m = await movementsModel.find({ strategy: strategy, open: true, broker: 'capital' }).sort({ myRegionalDate: -1 });
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
              console.error(`❌ Error closing position ${position.idRefBroker}:`, error);
              let mensaje = "error al realizar el cierre en capital, estrategia:" + strategy
              // await errorSendEmail(mensaje, error.response?.data || error.message)
              return "Error al cerrar la posición";
            }
          }
        }
        return "posiciones cerradas";
    }
    return undefined;
}

/**
 * @description (Lógica interna) Abre una posición.
 */
async function _capitalPosition(epic: string, size: number, type: string, strategy: string, io: Server) {
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
      console.error('❌ Error:', error);
      let mensaje = "error al realizar la compra en capital, estrategia:" + strategy
      await errorSendEmail(mensaje, error.data)
      return "Error al realizar la compra";
    }
}

/**
 * @description (Lógica interna) Lógica de trading compleja.
 */
async function _capitalbuyandsell(epic: string, size: number, type: string, strategy: string, io: Server) {
    let m = await movementsModel.find({ strategy: strategy, open: true, broker: 'capital' }).sort({ myRegionalDate: -1 });

    if (m.length === 0) {
      return await _capitalPosition(epic, size, type, strategy, io)
    }
  
    if (m[0]?.type === type.toUpperCase()) {
      return await _capitalPosition(epic, size, type, strategy, io)
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
          return "Error al cerrar la posición";
        }
      }
      return "posiciones cerradas";
    }
}

// --- Tareas de Verificación y Mantenimiento (No necesitan cola si son solo lecturas o auto-contenidas) ---

export async function verifyAndClosePositions() {
    // ... (código original sin cambios)
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
    // ... (código original sin cambios)
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