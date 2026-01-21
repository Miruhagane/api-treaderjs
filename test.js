const os = require('os');
const https = require('https');

console.log(12312)

console.log('RAILWAY_PROJECT_ID=', process.env.RAILWAY_PROJECT_ID || '<none>');
console.log('RAILWAY_ENV=', process.env.RAILWAY_ENV || '<none>');
console.log('HOSTNAME:', os.hostname());

https.get('https://ipinfo.io/json', res => {
    console.log('123ls')
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    try {
      const info = JSON.parse(body);
      console.log('IPINFO:', JSON.stringify({
        ip: info.ip,
        city: info.city,
        region: info.region,
        country: info.country,
        org: info.org
      }, null, 2));
    } catch (e) {
      console.log('IPINFO (raw):', body);
    }
  });
}).on('error', err => {
  console.error('Error fetching ipinfo:', err);
});