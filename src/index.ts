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
import { registerDashboardNamespace } from './config/db/dashboard';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger';

// Importa las funciones de los módulos de broker
// import { positions, accountBalance, capitalbuyandsell, getprices } from './capital';
import { positionBuy, positionSell, startBinanceFuturesPositionStream } from './binance';
import { fxcm } from './fxcm';
import baseLogger, { getLogger } from './config/logger';
import { globalErrorHandler } from './config/loggerMiddleware';
import expressPino from 'express-pino-logger';
import { dashboard, totalGananciaPorEstrategia, totalGananciaPorBroker, gananciaAgrupadaPorEstrategia, csv, startTotalGananciaEmitter, computeTotalGanancia } from './config/db/dashboard';

const app = express();
app.use(cors());
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// register dedicated dashboard namespace (separates dashboard socket traffic)
try {
  registerDashboardNamespace(io);
} catch (err) {
}

const queue = new PQueue({ concurrency: 1 });
const log = getLogger('index');
const expressLogger = expressPino({ logger: baseLogger });


// Middleware para parsear el cuerpo de las solicitudes JSON
app.use(bodyParser.json());
app.use(expressLogger);
app.use(globalErrorHandler);

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
  req.logger.info({ payload, route: req.originalUrl }, 'Recibida solicitud de compra en Binance');
  // logging removed


  queue.add(async () => {

    try {
      const result = await positionBuy(req.body.type, req.body.market, req.body.epic, req.body.leverage, req.body.size, req.body.strategy, io);
      res.status(200).send(result);

    } catch (error) {
      const logger = req.logger || baseLogger;
      logger.error({ err: error, route: req.originalUrl, reqId: (req as any).reqId }, 'Error en operación de compra en Binance');
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
      // logging removed
      const result = await positionSell(req.body.type, req.body.market, req.body.epic, req.body.leverage, req.body.size, req.body.strategy);
      res.status(200).send(result);
    }
    catch (error) {
      const lg = (req as any).logger || log;
      lg.error({ err: error, route: req.originalUrl, reqId: (req as any).reqId }, 'Error en operación de venta en Binance');
      res.status(500).send('Error al realizar la operación de venta en Binance');
    }
  });

});


/**
 * @swagger
 * /datatable-dashboard:
 *   get:
 *     summary: Obtiene datos para el dashboard
 *     description: Obtiene datos paginados para el dashboard, opcionalmente filtrados por varios campos.
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
 *       - in: query
 *         name: broker
 *         schema:
 *           type: string
 *         description: Broker (ej. binance).
 *       - in: query
 *         name: epic
 *         schema:
 *           type: string
 *         description: Epic/símbolo (ej. LTCUSDT).
 *       - in: query
 *         name: market
 *         schema:
 *           type: string
 *         description: Tipo de mercado (ej. FUTURE, SPOT).
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Tipo de operación (buy/sell).
 *       - in: query
 *         name: open
 *         schema:
 *           type: boolean
 *         description: Filtrar por posiciones abiertas o cerradas.
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Fecha inicial (ISO) para `myRegionalDate`.
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *         description: Fecha final (ISO) para `myRegionalDate`.
 *       - in: query
 *         name: minGanancia
 *         schema:
 *           type: number
 *         description: Ganancia mínima a filtrar.
 *       - in: query
 *         name: maxGanancia
 *         schema:
 *           type: number
 *         description: Ganancia máxima a filtrar.
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
  const limit = Math.min(parseInt(req.query.limit as string) || 5, 100);

  const filters = {
    strategy: req.query.strategy as string || undefined,
    broker: req.query.broker as string || undefined,
    epic: req.query.epic as string || undefined,
    market: req.query.market as string || undefined,
    type: req.query.type as string || undefined,
    open: req.query.open === 'true' ? true : req.query.open === 'false' ? false : undefined,
    dateFrom: req.query.dateFrom as string || undefined,
    dateTo: req.query.dateTo as string || undefined,
    minGanancia: req.query.minGanancia ? Number(req.query.minGanancia) : undefined,
    maxGanancia: req.query.maxGanancia ? Number(req.query.maxGanancia) : undefined,
  };

  const result = await dashboard(page, limit, filters as any);
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


app.post('/fxcm/buy', async (req, res) => {
  const { epic, size, type, strategy } = req.body;
  req.logger.info({ payload: req.body, route: req.originalUrl }, 'Recibida solicitud de compra en FXCM');
  // Convertimos 'size' a número y lo redondeamos a entero después de aplicar el factor
  // Por ejemplo, si el bridge espera micro-contratos (1.6 -> 160)
  const numericSize = typeof size === 'string' ? parseFloat(size) : size;
  const normalizedSize = Math.floor(numericSize);

  try {
    // Enviamos normalizedSize ya como un número entero
    const result = await fxcm(epic, normalizedSize, type, strategy, io);
    res.status(200).send(result);
  } catch (error) {
    const logger = req.logger || baseLogger;

    logger.error({ err: error, route: req.originalUrl, reqId: (req as any).reqId }, 'Error en operación de compra en FXCM');

    res.status(500).send('Error al realizar la operación de compra en FXCM');
  }
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
  // send current total ganancia to the newly connected client
  (async () => {
    try {
      const total = await computeTotalGanancia();
      socket.emit('dashboard:totalGanancia', { total });
    } catch (err) {
      const lg = (socket as any).logger || log;
      lg.error({ err }, 'Error sending initial totalGanancia to client');
    }
  })();

  // no dashboard handlers here — dashboard uses its own namespace (/dashboard)

  socket.on('disconnect', () => {

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

    // 2. Iniciar streams (Binance, etc.)
    startBinanceFuturesPositionStream(io).catch((err) => {
      // log error
    });

    try {
      startTotalGananciaEmitter(io, 5000);
    } catch (err) {
      const lg = getLogger('index');
      lg.error({ err }, 'Failed to start total ganancia emitter');
    }

    // 3. INICIAR EL SERVIDOR
    // IMPORTANTE: '0.0.0.0' es vital para que Docker/Railway acepten conexiones externas
    const port = parseInt(process.env.PORT || '3000');

    httpServer.listen(port, '0.0.0.0', () => {
      console.log(`🚀 API Node lista en puerto ${port}`);
    });

  } catch (error) {
    console.error('❌ Error fatal al iniciar el servidor:', error);
    process.exit(1);
  }
};

startServer();