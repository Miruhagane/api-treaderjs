# Documentación del Proyecto: api-treaderjs

Esta documentación centraliza la información del proyecto, incluidos los microservicios, variables de entorno, ejemplos de uso y pautas de despliegue.

## Resumen

api-treaderjs es una API de trading escrita en Node.js/TypeScript que actúa como un puente hacia múltiples brokers (Binance, Capital.com) y dispone de un microservicio adicional en .NET para conectar con FXCM (microservices/fxcm-bridge/FxcmBridge).

## Estructura del repositorio (relevante)

- api-treaderjs.sln
- docker-compose.yml
- Dockerfile
- package.json
- src/ (API Node/TypeScript)
  - lib/
  - brokers/
  - config/
- microservices/fxcm-bridge/FxcmBridge (servicio .NET para FXCM)
- scripts/

## Variables de entorno (esenciales)

- `PORT` — puerto del servidor Node (la mayoría de plataformas inyectan su propio `PORT`).
- `MongoDb_Conection` — cadena de conexión a MongoDB.
- `RABBITMQ_URL` — conexión a RabbitMQ.
- `RESEND_API_KEY` — API Key para servicio de emails.
- `Binance_ApiKey`, `Binance_ApiSecret` — credenciales para Binance.
- `Capital_ApiKey`, `Capital_Password`, `Capital_identifier` — credenciales para Capital.com.
- `BRIDGE_URL` — URL del FXCM Bridge (por ejemplo `http://localhost:5000` o `http://host.docker.internal:5000` en local con Docker).
- `FXCM_USER`, `FXCM_PASS`, `FXCM_ENV` — credenciales para FXCM (usadas por el bridge).

Notas:
- No subir `.env` con secrets al repositorio. Usa variables de entorno del proveedor cloud (Railway, Heroku, etc.).
- `host.docker.internal` funciona en Docker Desktop localmente, no en entornos cloud.

## Microservicio FXCM Bridge

Ubicación: microservices/fxcm-bridge/FxcmBridge

Endpoints importantes expuestos por el bridge:

- `POST /fxcm/order` — abrir orden.
  - Body: `{ symbol, side, size, orderType }`.
  - Respuesta: `{ success: true, orderId, dealId }` (si se capturó el trade)

- `POST /fxcm/close` — cerrar posición.
  - Body: `{ tradeId }`.
  - Respuesta: `{ success: true, tradeId, data: { closePrice, grossPL, netPL } }`

- `GET /fxcm/health` — devuelve estado de conexión.

Ejecución local:

```powershell
cd microservices/fxcm-bridge/FxcmBridge
dotnet run
```

## Cómo ejecutar el proyecto (local)

1. Copia `.env.example` a `.env` y rellena las variables.
2. Instala dependencias:

```bash
npm install
```

3. Ejecutar en desarrollo:

```bash
npm run dev
```

4. Levantar todo con Docker Compose:

```bash
docker-compose up --build
```

## Ejemplos rápidos

## Endpoints Node API (Trading)

Base local: `http://localhost:3000`

Swagger UI: `http://localhost:3000/api-docs`

### Endpoints GET (dashboard/analítica)

- `GET /`
- `GET /datatable-dashboard`
- `GET /active_trades`
- `GET /ganancia_estrategia`
- `GET /ganancia_linechart`
- `GET /ganancia_broker`
- `GET /csv`

### Endpoints POST (trading)

- `POST /binance/buy`
  - Descripción: abre una posición en Binance (SPOT/FUTURE).
  - Body ejemplo:

```json
{
  "epic": "BTCUSDT",
  "size": 0.001,
  "type": "BUY",
  "strategy": "ema_cross",
  "market": "FUTURE",
  "leverage": 10
}
```

- `POST /binance/sell`
  - Descripción: cierra posiciones abiertas en Binance (uso principal en FUTURE).
  - Body ejemplo:

```json
{
  "epic": "BTCUSDT",
  "size": 0.001,
  "type": "SELL",
  "strategy": "ema_cross",
  "market": "FUTURE",
  "leverage": 10
}
```

- `POST /binance/continuous`
  - Descripción: modo continuo. Si no hay posición abierta del mismo tipo para `epic + strategy + market`, abre una nueva. Si existe una posición abierta del tipo opuesto, la cierra.
  - Body mínimo recomendado: `epic`, `size`, `type`, `strategy`, `market`.
  - Body ejemplo:

```json
{
  "epic": "BTCUSDT",
  "size": 0.001,
  "type": "BUY",
  "strategy": "ema_cross",
  "market": "FUTURE",
  "leverage": 10
}
```

- `POST /fxcm/buy`
  - Descripción: ejecuta orden vía bridge FXCM.
  - Body ejemplo:

```json
{
  "epic": "BTC/USD",
  "size": 1,
  "type": "BUY",
  "strategy": "ema_cross"
}
```

- `POST /fxcm/continuous`
  - Descripción: modo continuo en FXCM. Abre si no hay abierta del mismo tipo y cierra si hay una del tipo opuesto para `epic + strategy + market`.
  - Nota: actualmente soporta `market = FUTURE`.
  - Body ejemplo:

```json
{
  "epic": "BTC/USD",
  "size": 1,
  "type": "BUY",
  "strategy": "ema_cross",
  "market": "FUTURE"
}
```

Abrir orden (PowerShell):

```powershell
$body = @{ symbol = 'BTC/USD'; side = 'BUY'; size = 0.01; orderType = 'MARKET' } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://localhost:5000/fxcm/order' -Method POST -ContentType 'application/json' -Body $body
```

Cerrar por `tradeId` (PowerShell):

```powershell
$body = @{ tradeId = 'TU_TRADE_ID' } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://localhost:5000/fxcm/close' -Method POST -ContentType 'application/json' -Body $body
```

Cerrar por `tradeId` (Node.js + axios):

```javascript
const axios = require('axios');
await axios.post('http://localhost:5000/fxcm/close', { tradeId: 'TU_TRADE_ID' });
```

Uso desde el propio proyecto:
- `src/lib/fxcm/fxcmMarket.ts` contiene funciones `buyFxcm` y `closeFxcm` que consumen el bridge. `closeFxcm(id)` envía `{ tradeId: id }`.

## Despliegue en Railway / Cloud

- Configura todas las variables de entorno en el dashboard de Railway; marca secrets (FXCM credentials, DB connection string).
- Reemplaza `BRIDGE_URL` por la URL pública del bridge (no usar host.docker.internal).
- Railway provee `PORT` automáticamente.

## Logs y monitoreo

- El proyecto usa `pino` para logging estructurado. En desarrollo `pino-pretty` se usa para salida legible.
- Los logs se envían por stdout/stderr y son capturados por plataformas como Railway.

## Testing

```bash
npm test
```

## Próximos pasos recomendados

- Generar colección Postman/Insomnia para todos los endpoints.
- Añadir documentación OpenAPI / Swagger para los endpoints Node y/o el bridge.
- Documentar diagramas de arquitectura en `docs/`.

---

Si quieres, puedo reemplazar el README.md raíz con este contenido y generar una colección Postman automáticamente. Dime si lo hago.