/**
 * @file Punto de entrada principal del servidor Express.
 * Configura la aplicación, las rutas de la API y la conexión a la base de datos.
 */

import express from 'express';
import bodyParser from 'body-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { dbconection } from './config/db';
import cors from 'cors';

// Importa las funciones de los módulos de broker
import { positions, accountBalance, active } from './capital';
import { position } from './binance';
import { dashboard } from './config/db/dashboard';

const app = express();
app.use(cors());
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Establece la conexión con la base de datos
dbconection();

// Middleware para parsear el cuerpo de las solicitudes JSON
app.use(bodyParser.json());

/**
 * @route GET /
 * @description Ruta de health check para verificar que el servidor está activo.
 * @returns {string} Un mensaje indicando que el servidor está activo.
 */
app.get('/', (req, res) => {
  res.send('servidor activo activo');
});

/**
 * @route GET /capital_balance
 * @description Obtiene y devuelve el balance de la cuenta de Capital.com.
 * @returns {Promise<object>} El balance de la cuenta.
 */
app.get('/capital_balance', (req, res) => {
  res.send(accountBalance());
});

/**
 * @route POST /capital_position
 * @description Crea una nueva posición en Capital.com.
 * @param {object} req.body - El payload de la solicitud, que debe contener epic, size, type y strategy.
 * @returns {Promise<object>} Un objeto con el resultado de la operación.
 */
app.post('/capital_position', async (req, res) => {
  const payload = req.body;
  console.log(payload);
  try {
    let result = await positions(payload.epic, payload.size, payload.type, payload.strategy, io);
    res.send({ data: result });
  } catch (e) {
    console.log(e);
    res.send('Error al realizar la posicion');
  }
});

/**
 * @route POST /binance
 * @description Crea una nueva posición en Binance.
 * @param {object} req.body - El payload de la solicitud, que debe contener el 'type' de la orden.
 * @returns {Promise<object>} El resultado de la operación de posicionamiento.
 */
app.post('/binance', (req, res) => {
  const payload = req.body;
  const result = position(payload.type, payload.strategy, io);
  res.send({data: result});
});

app.get('/datatable-dashboard', async (req, res) => {

  console.log("ejecucion");
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 5;
    const result = await dashboard(page, limit);
    res.json(result);
});

app.get('/chart-data', async (req, res) => {
   const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 5;
    const result = await dashboard(page, limit);
    res.json(result);
});


io.on('connection', (socket) => {
  console.log('a user connected');
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

// Inicia el servidor en el puerto especificado por la variable de entorno o en el 3000 por defecto.
const port = parseInt(process.env.PORT || '3000');
httpServer.listen(port, () => {
  console.log(`listening on port ${port}`);
});