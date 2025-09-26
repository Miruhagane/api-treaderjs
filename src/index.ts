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
import { positions, accountBalance, idrefVerification } from './capital';
import { position } from './binance';
import { dashboard, totalGananciaPorEstrategia, totalGananciaPorBroker, gananciaAgrupadaPorEstrategia } from './config/db/dashboard';

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
 * @route POST /prueba
 * @description Ruta de prueba para verificar la verificación de ID de referencia.
 * @param {object} req.body - El payload de la solicitud, que debe contener 'id' y 'strategy'.
 * @returns {Promise<string>} El resultado de la verificación del ID de referencia.
 */
app.post('/prueba', async (req, res) => {
  console.log(req.body);
  const payload = req.body;

  let r = await idrefVerification(payload.id, payload.strategy)
  return res.send(r);
})

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
 * @param {object} req.body - El payload de la solicitud, que debe contener el 'type' de la orden y 'strategy'.
 * @returns {Promise<object>} El resultado de la operación de posicionamiento.
 */
app.post('/binance', (req, res) => {
  const payload = req.body;
  const result = position(payload.type, payload.strategy, io);
  res.send({ data: result });
});

/**
 * @route GET /datatable-dashboard
 * @description Obtiene datos paginados para el dashboard, opcionalmente filtrados por estrategia.
 * @param {number} [req.query.page=1] - El número de página a recuperar.
 * @param {number} [req.query.limit=5] - El número de elementos por página.
 * @param {string} [req.query.strategy=''] - La estrategia por la cual filtrar.
 * @returns {Promise<object>} Un objeto que contiene los movimientos, el total de páginas y la página actual.
 */
app.get('/datatable-dashboard', async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 5;
  const strategy = req.query.strategy as string || '';
  const result = await dashboard(page, limit, strategy);
  res.json(result);
});

/**
 * @route GET /ganancia_estrategia
 * @description Calcula la ganancia total por estrategia para un número de días dado.
 * @param {number} [req.query.days=7] - El número de días a considerar hacia atrás.
 * @returns {Promise<object>} Un array de objetos, cada uno con la estrategia y su ganancia total.
 */
app.get('/ganancia_estrategia', async (req, res) => {
  const filter = req.query.filter as string || 'todo';
  const result = await totalGananciaPorEstrategia(filter);
  res.json(result);
});

/**
 * @route GET /ganancia_linechart
 * @description Obtiene la ganancia agrupada por estrategia, ya sea mensual o diaria, para un número de días dado.
 * @param {number} [req.query.days=7] - El número de días a considerar hacia atrás.
 * @param {('mensual'|'diario')} [req.query.periodo='mensual'] - El período para agrupar (mensual o diario).
 * @returns {Promise<object>} Un array de entradas de datos formateadas para el gráfico de líneas.
 */
app.get('/ganancia_linechart', async (req, res) => {
  const days = parseInt(req.query.days as string) || 7;
  const periodo = (req.query.periodo as 'mensual' | 'diario') || 'mensual';
  const result = await gananciaAgrupadaPorEstrategia(days, periodo);
  res.json(result);
})

/**
 * @route GET /ganancia_broker
 * @description Calcula la ganancia total por broker para un número de días dado.
 * @param {number} [req.query.days=7] - El número de días a considerar hacia atrás.
 * @returns {Promise<object>} Un array de objetos, cada uno con el broker y su ganancia total.
 */
app.get('/ganancia_broker', async (req, res) => {
 const filter = req.query.filter as string || 'todo';
  const result = await totalGananciaPorBroker(filter);
  res.json(result);
});

/**
 * Configuración y manejo de eventos de Socket.IO.
 * Emite eventos de 'dashboard_update' cuando hay cambios en las posiciones.
 */
/**
 * Configuración y manejo de eventos de Socket.IO.
 * Emite eventos de 'dashboard_update' cuando hay cambios en las posiciones.
 */
io.on('connection', (socket) => {
  console.log('a user connected');
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

/**
 * Inicia el servidor en el puerto especificado por la variable de entorno o en el 3000 por defecto.
 */
const port = parseInt(process.env.PORT || '3000');
httpServer.listen(port, () => {
  console.log(`listening on port ${port}`);
});