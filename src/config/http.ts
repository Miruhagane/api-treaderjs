import axios from 'axios';
import http from 'http';
import https from 'https';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

const axiosInstance = axios.create({
    timeout: 5000,
    httpAgent,
    httpsAgent,
});

export default axiosInstance;
