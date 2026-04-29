# API de Trading Multi-Broker

Este proyecto es una API de trading desarrollada en Node.js, Express y TypeScript, diseñada para actuar como un puente unificado para interactuar con múltiples plataformas de trading. Actualmente, ofrece soporte para **Binance** y **Capital.com**, con una arquitectura que facilita la adición de nuevos brokers.

## ✨ Características

- **Soporte Multi-Broker:** Conecta y opera en Binance y Capital.com a través de una única API.
- **Base de Datos Persistente:** Utiliza MongoDB con Mongoose y Typegoose para registrar todos los movimientos y posiciones de trading.
- **Gestión de Sesión Avanzada:** Incluye un sistema de gestión de sesiones para Capital.com que cachea los tokens de API en la base de datos. Esto evita errores de "Too Many Requests", mejora el rendimiento y asegura que las sesiones se reutilicen de manera eficiente.
- **API RESTful:** Endpoints claros para gestionar balances y posiciones.
- **Escrito en TypeScript:** Código tipado para mayor robustez y mantenibilidad.
- **Listo para Pruebas:** Incluye una configuración básica de testing con Jest y Supertest.

## 🚀 Getting Started

Sigue estos pasos para configurar y ejecutar el proyecto en tu entorno local.

### Prerrequisitos

- [Node.js](https://nodejs.org/) (versión 14 o superior)
- [npm](https://www.npmjs.com/)
- Una instancia de [MongoDB](https://www.mongodb.com/try/download/community) (local o en la nube).

### 1. Instalación

Clona el repositorio y luego instala las dependencias del proyecto:

```sh
git clone <URL_DEL_REPOSITORIO>
cd api-treaderjs
npm install
```

### 2. Configuración

El proyecto utiliza un archivo `.env` para gestionar las variables de entorno. Crea un archivo `.env` en la raíz del proyecto. Puedes usar el siguiente ejemplo como plantilla:

**.env.example**
```
# Puerto del servidor
PORT=3000

# Credenciales de Binance (API de prueba o real)
Binance_ApiKey=TU_API_KEY_DE_BINANCE
Binance_ApiSecret=TU_API_SECRET_DE_BINANCE

# Credenciales de Capital.com
Capital_ApiKey=TU_API_KEY_DE_CAPITAL
Capital_Password=TU_PASSWORD_DE_CAPITAL
Capital_identifier=TU_IDENTIFIER_DE_CAPITAL

# Conexión a MongoDB
MongoDb_Conection=mongodb://localhost:27017/trading_api

# URL de conexión de RabbitMQ
RABBITMQ_URL=amqp://localhost

# Clave de API de Resend para el envío de correos
RESEND_API_KEY=TU_API_KEY_DE_RESEND
```

### 3. Ejecutar la Aplicación

- **Modo de Desarrollo** (con recarga automática gracias a `nodemon`):
  ```sh
  npm run dev
  ```

- **Modo de Producción:**
  ```sh
  npm run build
  npm start
  ```

### 4. Ejecutar con Docker

Una vez que hayas configurado tu archivo `.env` con las variables de entorno necesarias, puedes levantar la aplicación usando Docker Compose:

```sh
docker-compose up --build
```

La API estará disponible en `http://localhost:3000`.

## ⚙️ API Endpoints

Aquí están los endpoints disponibles en la API (también visibles en Swagger en `/api-docs`):

| Método | Ruta                  | Descripción                                                              | Body (Payload) de Ejemplo                                    |
|--------|-----------------------|--------------------------------------------------------------------------|--------------------------------------------------------------|
| `GET`  | `/`                   | Endpoint de health check para verificar si el servidor está activo.      | N/A                                                          |
| `GET`  | `/datatable-dashboard`| Devuelve movimientos paginados con filtros (dashboard).                  | N/A                                                          |
| `GET`  | `/active_trades`      | Devuelve conteo de trades activos.                                       | N/A                                                          |
| `GET`  | `/ganancia_estrategia`| Ganancia agregada por estrategia.                                        | N/A                                                          |
| `GET`  | `/ganancia_linechart` | Serie para gráfica de ganancia (diaria/mensual).                         | N/A                                                          |
| `GET`  | `/ganancia_broker`    | Ganancia agregada por broker.                                            | N/A                                                          |
| `GET`  | `/csv`                | Exporta movimientos a CSV.                                               | N/A                                                          |
| `POST` | `/binance/buy`        | Ejecuta orden de apertura en Binance (SPOT/FUTURE).                      | `{ "epic": "BTCUSDT", "size": 0.001, "type": "BUY", "strategy": "ema_cross", "market": "FUTURE", "leverage": 10 }` |
| `POST` | `/binance/sell`       | Ejecuta cierre de posiciones en Binance (principalmente FUTURE).         | `{ "epic": "BTCUSDT", "size": 0.001, "type": "SELL", "strategy": "ema_cross", "market": "FUTURE", "leverage": 10 }` |
| `POST` | `/binance/continuous` | Modo continuo: abre una posición o cierra la opuesta por `epic/strategy/market`. | `{ "epic": "BTCUSDT", "size": 0.001, "type": "BUY", "strategy": "ema_cross", "market": "FUTURE", "leverage": 10 }` |
| `POST` | `/fxcm/buy`           | Abre operación en FXCM vía bridge.                                       | `{ "epic": "BTC/USD", "size": 1, "type": "BUY", "strategy": "ema_cross" }` |
| `POST` | `/fxcm/continuous`    | Modo continuo en FXCM: abre posición o cierra la opuesta por `epic/strategy/market`. | `{ "epic": "BTC/USD", "size": 1, "type": "BUY", "strategy": "ema_cross", "market": "FUTURE" }` |

## 🧪 Testing

Para ejecutar la suite de tests, utiliza el siguiente comando:

```sh
npm test
```

## 📝 Registro (Logs)
Se han eliminado las llamadas directas a `console.log()` en el código fuente para evitar salida de consola no controlada en producción. El proyecto ahora usa `pino` como logger estructurado y `express-pino-logger` para el logging HTTP.

- **Logger central:** `src/config/logger.ts` expone un `baseLogger` y una función `getLogger(moduleName)` para crear loggers con campos estándar: `service`, `module`, etc.
- **HTTP logging:** `express-pino-logger` está registrado en la app; además existe `src/config/loggerMiddleware.ts` que asigna `req.reqId` y `req.logger` (child logger) para cada petición.
- **Formato legible en desarrollo:** `pino-pretty` está instalado como dependencia de desarrollo y se activa cuando `NODE_ENV=development` (el logger usa `pino-pretty` como transport en desarrollo).

Variables de entorno relevantes:

- `LOG_LEVEL` — nivel de log (`trace`, `debug`, `info`, `warn`, `error`, `fatal`). Por defecto `info`.
- `NODE_ENV` — si está en `development`, los logs se formatean con `pino-pretty` para facilitar la lectura local.

Ejemplos de ejecución durante desarrollo (Windows PowerShell):

```powershell
$env:NODE_ENV = 'development'
$env:LOG_LEVEL = 'debug'
npm run dev
```

En Linux / macOS:

```bash
NODE_ENV=development LOG_LEVEL=debug npm run dev
```

Qué aparece en la consola / Railway:

- Todos los logs estructurados generados por `pino` y `express-pino-logger` salen por `stdout` (info) o `stderr` (errores). Railway captura ambos streams y muestra los registros en su panel de logs.
- Cada petición HTTP incluye un `reqId` y metadatos (`method`, `url`, `status`, `time`) y los controladores pueden utilizar `req.logger` para añadir contexto adicional (`strategy`, `epic`, `orderId`, etc.).

Buenas prácticas recomendadas:

- Usa `getLogger(moduleName)` para obtener un logger con campos estándar por módulo.
- En handlers usa `const lg = req.logger || getLogger('module')` y registra `lg.info({ event: 'something_happened', ...meta }, 'event_short_message')`.
- Evita imprimir objetos grandes sin procesar; registra sólo campos relevantes (ids, estados, errores con stack en `error`).

Si quieres que lo adapte para enviar logs a un servicio externo (Logflare, Datadog, etc.) o que los errores vayan explícitamente a `stderr`, lo implemento.

## 🏛️ Arquitectura y Decisiones de Diseño

### Gestión de Sesión y Tokens

Para evitar exceder los límites de solicitudes de la API de Capital.com y mejorar la eficiencia, se ha implementado un sistema de gestión de sesiones que utiliza la base de datos como caché.

- **Modelo `Token`:** Se ha creado un modelo en `src/config/models/tokens.ts` que almacena los tokens de sesión (`CST` y `X-SECURITY-TOKEN`) junto con un `timestamp`.
- **`sessionManager.ts`:** Este módulo (`src/config/sessionManager.ts`) se encarga de:
  1.  Verificar si existe un token válido y no expirado en la base de datos.
  2.  Si existe, lo devuelve para ser utilizado en las solicitudes a la API.
  3.  Si no existe o ha expirado, solicita nuevos tokens a Capital.com, los guarda (o actualiza) en la base de datos y los devuelve.

Este enfoque centralizado reduce drásticamente el número de inicios de sesión, solucionando el problema de `error.too-many.requests` y haciendo que la API sea más robusta y rápida.
