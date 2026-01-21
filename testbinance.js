const axios = require('axios');
const crypto = require('crypto');

async function getServerTime(baseURL) {
  const res = await axios.get(`${baseURL}/api/v3/time`, { timeout: 10000 });
  return res.data.serverTime;
}

function sign(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

async function testOrder() {
  const baseURL = process.env.BINANCE_BASEURL || 'https://demo-api.binance.com';
  const apiKey = process.env.Binance_ApiKey;
  const secret = process.env.Binance_ApiSecret;
  if (!apiKey || !secret) {
    console.error('Faltan BINANCE_APIKEY o BINANCE_SECRET en variables de entorno.');
    process.exit(1);
  }

  try {
    // 1) sincronizar tiempo con Binance
    const serverTime = await getServerTime(baseURL);

    // 2) construir parámetros (timestamp desde serverTime)
    const paramsObj = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: '0.001',
      timestamp: serverTime.toString()
    };

    // Construir query string (orden determinista)
    const queryString = Object.keys(paramsObj)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(paramsObj[k])}`)
      .join('&');

    // 3) firmar la query string
    const signature = sign(queryString, secret);

    // 4) cuerpo form-urlencoded con signature incluido
    const body = `${queryString}&signature=${signature}`;

    // Escoge endpoint: /order/test para no crear orden real
    const useTest = (process.env.BINANCE_USE_TEST === '1' || process.env.BINANCE_USE_TEST === 'true');
    const path = useTest ? '/api/v3/order/test' : '/api/v3/order';

    // 5) POST con content-type application/x-www-form-urlencoded
    const url = `${baseURL}${path}`;

    console.log('Request URL:', url);
    console.log('Request body (signature redacted):', body.replace(/signature=[a-f0-9]+/i, 'signature=REDACTED'));

    const res = await axios.post(url, body, {
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 20000
    });

    console.log('OK:', res.status);
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('ERROR status:', err.response?.status ?? err.code ?? err.message);
    console.error('ERROR headers:', JSON.stringify(err.response?.headers ?? {}, null, 2));
    console.error('ERROR data:', JSON.stringify(err.response?.data ?? err.message, null, 2));

    // Si hubo request body/url, mostrar (con signature redacted) para diagnóstico
    try {
      if (err.config && err.config.url) {
        const shownUrl = err.config.url.replace(/signature=[a-f0-9]+/i, 'signature=REDACTED');
        console.error('Sent URL (redacted):', shownUrl);
      }
      if (err.config && err.config.data) {
        const shownBody = String(err.config.data).replace(/signature=[a-f0-9]+/i, 'signature=REDACTED');
        console.error('Sent body (redacted):', shownBody);
      }
    } catch (e) {
      // ignore
    }

    process.exit(1);
  }
}

testOrder();    