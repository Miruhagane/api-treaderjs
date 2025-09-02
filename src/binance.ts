import axios, { AxiosRequestConfig } from "axios"
import Binance from 'node-binance-api';



interface CryptoBalance {
  available: string;
  onOrder: string;
}

interface Balances {
  [key: string]: CryptoBalance; // Índice de firma para cualquier propiedad
  BTC?: CryptoBalance;          // Opcional
}


// const binance = new Binance({
//   APIKEY: '92f8560fc6ba6286930ff5f153761035c0a9525da0eb07ffcf88bfadc3455b14',
//   APISECRET: 'a861f99f4767009f8d0e7487cf26aa1520a85f8300eccf0f86befb99c19230f9',
//   test: true
  
//   });

  const binance = new Binance({
    APIKEY: 'kwZxslNj9OdWFs74XCirR1pZRrTtY4O3pTzTtiPJRzrJXOyLK7Jy77GpNJMMqGNU',
    APISECRET: 'KboIZH5VT6gEXmTkCrC3MsaIWmtv8NvaWR5NKf6Zs5uidR2oXM4DYFTjNmFMYwG8',
    test: true
    
    });
  async function setposition( side: string, price:number) {    


    let order: string = "0" 
    let balance: Balances = await binance.balance()
    
    
    try {

      switch (side.toUpperCase())
      {
        case 'BUY': 

        let order1 =  await binance.order('LIMIT', 'BUY', 'BTCUSDT', 0.001, price)
        console.log('orden nueva =>', order1)


        let newbalance: Balances = await binance.balance();
        console.log(newbalance.BTC)

        return "compra hecha con exito"

        case 'SELL':

        if(balance.BTC !== undefined) 
          {
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


export const position = async (type: string) => {

  let price = await binance.prices('BTCUSDT')
  console.log(price.BTCUSDT)


  if(price.BTCUSDT !== undefined)
    {
      return setposition(type, price.BTCUSDT)
    }
    
  }