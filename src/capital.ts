import axios, { AxiosRequestConfig } from "axios"
import * as crypto from 'crypto';

const RSA_ALGORITHM = 'rsa';
const PKCS1_PADDING_TRANSFORMATION = 'RSA-PKCS1';

const API_KEY = 'i3yycAAfYl1WYQrb'
const capitalPassword = 'kUROSAKI23.'
const url_api = 'https://demo-api-capital.backend-capital.com/api/v1/'
const identifier = 'ricardokurosaki23@gmail.com'


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

//funcion de balance de la cuenta y retornarlo al cliente
export const accountBalance = async () => {
  const sesiondata = await login();
  const accountBalance = await getAccountBalance(sesiondata.XSECURITYTOKEN, sesiondata.CST)
  return accountBalance.accounts
}

//funcion de compra para capital.com y retornarlo al cliente
export const positions = async (epic: string, size: number, type: string) => {

  const sesiondata = await login();
  const accountBalance = await getAccountBalance(sesiondata.XSECURITYTOKEN, sesiondata.CST)

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
        .then((response) => {
          console.log('✅ Respuesta:', response.data);
        })
        .catch((error) => {
          console.error('❌ Error:', error.response?.data || error.message);
        });

      break;

    case ('sell'):

    const positionslist = await axios.get(`${url_api}positions`, {
      headers: {
        'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
        'CST': sesiondata.CST,
        'Content-Type': 'application/json',
      }
    })

    let dealId = positionslist.data.positions[0].position.dealId

    const positionClose = await axios.delete(`${url_api}positions/${dealId}`, {
      headers: {
        'X-SECURITY-TOKEN': sesiondata.XSECURITYTOKEN,
        'CST': sesiondata.CST,
        'Content-Type': 'application/json',
      }
    })

    console.log(positionClose.data)


      break;
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


