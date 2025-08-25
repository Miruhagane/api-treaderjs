import axios, { AxiosRequestConfig } from "axios"
import Binance from 'node-binance-api';


const client = new Binance({
    APIKEY: 'cGCzBw532wZx5rSb3H7cjSKQlx5DjPEkgsp5qX9S9UpNO5GE8y6fzJrJmxl57ZcX',
    APISECRET: 'WmBzQRALEVUPF9gz7p6cTKrYIBmOvwvrGATeDxYmrbCYGaPE3T3Fcx1HM2bG88qB',
  });



export const position = async () => {
    const price = await client.prices("BTCUSDT" );
    console.log("Precio BTC/USDT:", price.BTCUSDT);
    return price.BTCUSDT
  }