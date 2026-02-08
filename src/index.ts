/**
 * @file Punto de entrada principal del servidor Express.
 * Configura la aplicación, las rutas de la API y la conexión a la base de datos.
 */

import express from 'express';
import bodyParser from 'body-parser';
import PQueue from 'p-queue';
import { Parser } from 'json2csv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { dbconection } from './config/db';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger';

// Importa las funciones de los módulos de broker
// import { positions, accountBalance, capitalbuyandsell, getprices } from './capital';
import { positionBuy, positionSell, startBinanceFuturesPositionStream } from './binance';
import { dashboard, totalGananciaPorEstrategia, totalGananciaPorBroker, gananciaAgrupadaPorEstrategia, csv } from './config/db/dashboard';

const app = express();
app.use(cors());
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const queue = new PQueue({ concurrency: 1 });


// Middleware para parsear el cuerpo de las solicitudes JSON
app.use(bodyParser.json());

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @swagger
 * /:
 *   get:
 *     summary: Ruta de health check
 *     description: Verifica que el servidor está activo.
 *     responses:
 *       200:
 *         description: Servidor activo.
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: servidor activo activo
 */
app.get('/', (req, res) => {
  res.send('servidor activo activo');
});
app.post('/binance/buy', (req, res) => {

  const payload = req.body;

  console.log(payload)

  queue.add(async () => {

    try {
      const result = await positionBuy(req.body.type, req.body.market, req.body.epic, req.body.leverage, req.body.size, req.body.strategy);
      res.status(200).send(result);

    } catch (error) {
      console.error('Error en operación de compra en Binance:', error);
      res.status(500).send('Error al realizar la operación de compra en Binance');
    }
  });

});

app.post('/binance/sell', (req, res) => {

  const payload = req.body;
  if (payload.market.toUpperCase() === 'SPOT') {
    return res.send({ data: 'Operaciones Spot no permitidas' });
  }

  queue.add(async () => {

    try {
      console.log('Ejecutando operación de venta en Binance...');
      console.log('Payload recibido:', req.body);
      const result = await positionSell(req.body.type, req.body.market, req.body.epic, req.body.leverage, req.body.size, req.body.strategy);
      res.status(200).send(result);
    }
    catch (error) {
      console.error('Error en operación de venta en Binance:', error);
      res.status(500).send('Error al realizar la operación de venta en Binance');
    }
  });

});

/**
 * @swagger
 * /datatable-dashboard:
 *   get:
 *     summary: Obtiene datos para el dashboard
 *     description: Obtiene datos paginados para el dashboard, opcionalmente filtrados por estrategia.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Número de página.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Número de elementos por página.
 *       - in: query
 *         name: strategy
 *         schema:
 *           type: string
 *         description: Estrategia para filtrar.
 *     responses:
 *       200:
 *         description: Datos del dashboard.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
app.get('/datatable-dashboard', async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 5;
  const strategy = req.query.strategy as string || '';
  const result = await dashboard(page, limit, strategy);
  res.json(result);
});

/**
 * @swagger
 * /csv:
 *   get:
 *     summary: Exporta los movimientos a CSV
 *     description: Exporta los movimientos a un archivo CSV, opcionalmente filtrados por estrategia.
 *     parameters:
 *       - in: query
 *         name: strategy
 *         schema:
 *           type: string
 *         description: Estrategia para filtrar.
 *     responses:
 *       200:
 *         description: Archivo CSV con los movimientos.
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
app.get('/csv', async (req, res) => {
  const strategy = req.query.strategy as string || '';
  const result = await csv(strategy);

  const fields = ["strategy", "buyPrice", "sellPrice", "ganancia", "broker", "date"];
  const parser = new Parser({ fields });
  const document = parser.parse(result);

  res.header("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=movimientos.csv");
  return res.send(document);
})


/**
 * @swagger
 * /ganancia_estrategia:
 *   get:
 *     summary: Calcula la ganancia total por estrategia
 *     description: Calcula la ganancia total por estrategia para un período de tiempo.
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [diario, semanal, mensual, todo]
 *         description: Periodo de tiempo para el filtro.
 *     responses:
 *       200:
 *         description: Ganancia total por estrategia.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 */
app.get('/ganancia_estrategia', async (req, res) => {
  const filter = req.query.filter as string || 'todo';
  const result = await totalGananciaPorEstrategia(filter);
  res.json(result);
});

/**
 * @swagger
 * /ganancia_linechart:
 *   get:
 *     summary: Obtiene datos para el gráfico de líneas de ganancia
 *     description: Obtiene la ganancia agrupada por estrategia, ya sea mensual o diaria.
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *         description: Número de días a considerar.
 *       - in: query
 *         name: periodo
 *         schema:
 *           type: string
 *           enum: [mensual, diario]
 *         description: Periodo de agrupación.
 *     responses:
 *       200:
 *         description: Datos para el gráfico de líneas.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 */
app.get('/ganancia_linechart', async (req, res) => {
  const periodo = req.query.periodo;
  const result = await gananciaAgrupadaPorEstrategia(periodo);
  res.json(result);
})

/**
 * @swagger
 * /ganancia_broker:
 *   get:
 *     summary: Calcula la ganancia total por broker
 *     description: Calcula la ganancia total por broker para un período de tiempo.
 *     parameters:
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *           enum: [diario, semanal, mensual, todo]
 *         description: Periodo de tiempo para el filtro.
 *     responses:
 *       200:
 *         description: Ganancia total por broker.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
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
  // logging removed
  socket.on('disconnect', () => {
    // logging removed
  });
});

/**
 * Inicia el servidor en el puerto especificado por la variable de entorno o en el 3000 por defecto.
 */

// Establece las conexiones y arranca el servidor
const startServer = async () => {
  try {
    // 1. Conectar a la base de datos
    await dbconection();

    // 4. Iniciar stream de posiciones de Binance Futures (WS)
    startBinanceFuturesPositionStream(io).catch((err) => {
      // logging removed
    });

    // 5. Iniciar el servidor HTTP
    const port = parseInt(process.env.PORT || '3000');
    httpServer.listen(port, () => {
      // logging removed
    });

  } catch (error) {
    // logging removed
    process.exit(1);
  }
};

startServer();