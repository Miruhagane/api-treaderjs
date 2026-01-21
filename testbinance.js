const axios = require('axios');

async function testOrder() {
  const baseURL = process.env.BINANCE_BASEURL || 'https://demo-api.binance.com'; // o demo-api si usas demo
  const apiKey = process.env.BINANCE_APIKEY;
  const signature = process.env.BINANCE_SIGNATURE; // usa variables según tu flow (mejor generar en runtime)
  const timestamp = Date.now();

  // Ejemplo: si firmas en el código, genera signature aquí y no lo pongas en env.
  const url = `${baseURL}/api/v3/order?symbol=BTCUSDT&side=BUY&type=MARKET&quantity=0.001&timestamp=${timestamp}${signature ? `&signature=${signature}` : ''}`;

  try {
    const res = await axios.post(url, {}, {
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    console.log('OK:', res.status, res.data);
  } catch (err) {
    console.error('ERROR status:', err.response?.status);
    console.error('ERROR headers:', JSON.stringify(err.response?.headers, null, 2));
    console.error('ERROR data:', JSON.stringify(err.response?.data, null, 2));
    console.error('ERROR full message:', err.message);
    // opcional: console.error(err.stack);
  }
}

testOrder();