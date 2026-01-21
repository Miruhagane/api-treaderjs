const axios = require('axios');
const crypto = require('crypto');
const util = require('util');

async function getServerTime(baseURL) {
  const res = await axios.get(`${baseURL}/api/v3/time`, { timeout: 10000 });
  return res.data.serverTime;
}

function sign(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

function safeLogError(label, err) {
  try {
    console.error(`${label} message:`, err?.message ?? err);
    if (err?.stack) console.error(`${label} stack:`, err.stack);
    if (err?.response) {
      console.error(`${label} response status:`, err.response.status);
      console.error(`${label} response data:`, util.inspect(err.response.data, { depth: 5 }));
      console.error(`${label} response headers:`, util.inspect(err.response.headers, { depth: 2 }));
    }
    if (err?.config) {
      console.error(`${label} request config:`, util.inspect({
        method: err.config.method,
        url: err.config.url,
        headers: err.config.headers,
        data: err.config.data
      }, { depth: 4 }));
    }
  } catch (loggingErr) {
    console.error('Error while logging:', loggingErr);
  }
}

(async function main() {
  const baseURL = process.env.BINANCE_BASEURL || 'https://demo-api.binance.com';
  const apiKey = process.env.Binance_ApiKey;
  const secret = process.env.Binance_ApiSecret;
  const useTest = (process.env.BINANCE_USE_TEST === '1' || process.env.BINANCE_USE_TEST === 'true' || process.env.BINANCE_USE_TEST === 1);

  if (!apiKey || !secret) {
    console.error('Faltan Binance_ApiKey o Binance_ApiSecret en variables de entorno.');
    process.exit(1);
  }

  try {
    const serverTime = await getServerTime(baseURL);

    const paramsObj = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: '0.001',
      timestamp: serverTime.toString()
    };

    // Ordenar claves para determinismo (opcional pero ayuda)
    const keys = Object.keys(paramsObj).sort();
    const queryString = keys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(paramsObj[k])}`).join('&');

    const signature = sign(queryString, secret);
    const body = `${queryString}&signature=${signature}`;

    const path = useTest ? '/api/v3/order/test' : '/api/v3/order';
    const url = `${baseURL}${path}`;

    console.log('Calling URL:', url);
    console.log('Request body (signature redacted):', body.replace(/signature=[a-f0-9]+/i, 'signature=REDACTED'));

    const res = await axios.post(url, body, {
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 20000
    });

    console.log('OK:', res.status);
    console.log('Response data:', util.inspect(res.data, { depth: 6 }));
    process.exit(0);
  } catch (err) {
    safeLogError('Order ERROR', err);
    // Si recibes 451 revisa KYC/eligibility en la cuenta y la ubicación/IP del entorno
    process.exit(1);
  }
})();