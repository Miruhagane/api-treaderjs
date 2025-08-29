import axios, { AxiosRequestConfig } from "axios"
import movementsModel from "./config/models/movements";

import dotenv from 'dotenv';
dotenv.config();

const RSA_ALGORITHM = 'rsa';
const PKCS1_PADDING_TRANSFORMATION = 'RSA-PKCS1';

const API_KEY = process.env.Capital_ApiKey;
const capitalPassword = process.env.Capital_Password;
const url_api = 'https://demo-api-capital.backend-capital.com/api/v1/'
const identifier = process.env.Capital_identifier



//funcion para hacer login
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
  return responseDataCapital

}

//funcion para obtener el balance de la cuenta 
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

async function allActivePositions(XSECURITYTOKEN: string, CST: string) {

  const positionslist = await axios.get(`${url_api}positions`, {
    headers: {
      'X-SECURITY-TOKEN': XSECURITYTOKEN,
      'CST': CST,
      'Content-Type': 'application/json',
    }
  })

  let activePositionslist = positionslist.data.positions;
  
  return activePositionslist[activePositionslist.length - 1].position.dealId;
  
}

//funcion de balance de la cuenta y retornarlo al cliente
export const accountBalance = async () => {
  const sesiondata = await login();
  const accountBalance = await getAccountBalance(sesiondata.XSECURITYTOKEN, sesiondata.CST)
  return accountBalance.accounts
}

//funcion de compra para capital.com y retornarlo al cliente
export const positions = async (epic: string, size: number, type: string, strategy: string) => {

  const sesiondata = await login();

  switch (type) {
    case ('buy'):
      const payloadCompra = {
        epic,
        direction: type.toUpperCase(),
        size: 0.01,
        orderType: 'MARKET', // Puedes usar 'LIMIT' si prefieres
        currencyCode: 'USD', // Ajusta según el mercado
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
    
      // Enviar la solicitud
      axios(options)
        .then(async (response) => {
          let idactive: any = await allActivePositions(sesiondata.XSECURITYTOKEN, sesiondata.CST);
          updateDbPositions(idactive, strategy, true, 'capital')
          return "posicion abierta"
        })
        .catch((error) => {
          console.error('❌ Error:', error.response?.data || error.message);

          return "Error al realizar la compra"
        });

   

      break;

    case ('sell'):

    const m = await movementsModel.find({ strategy: strategy, open: true, broker: 'capital' });
    console.log(m.length)
    if(m.length > 0)
    {
     return new Promise(async (resolve) => {
      for(let position of m)
        {
          const positionClose = await axios.delete(`${url_api}positions/${position.idRefBroker}`, {
            headers: {
              'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
              'CST': sesiondata.CST,
              'Content-Type': 'application/json',
            }
          })
          updateDbPositions(position.idRefBroker, strategy, false, 'capital')
          console.log(positionClose.data)
         setTimeout(() => 1000);
        }
        resolve("posiciones cerradas")
     })
    }
      break;
  }

}
async function updateDbPositions(id: string, strategy: string, open: boolean, broker: string){
  console.log(id)
  if(open){ 
    const m = await movementsModel.find({ idRefBroker: id});
    if(m.length === 0)
    {
      const newMovement = new movementsModel({
        idRefBroker: id,
        strategy: strategy,
        open: open,
        broker: broker,
        date: new Date()
      });
      await newMovement.save();

      return "creado y guardado"
    }
   }
  else{ 
    const m =  await movementsModel.updateOne({ idRefBroker: id }, { open: open });
    return "cerrado"
  }
}

//funcion de venta para capital.com
export const venta = () => {
  return {
    status: 'success',
    message: 'compra Realizada con exito',
    timeStamp: new Date()
  }
}


