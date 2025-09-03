# API de Trading Multi-Broker

Este proyecto es una API de trading desarrollada en Node.js, Express y TypeScript, diseñada para actuar como un puente unificado para interactuar con múltiples plataformas de trading. Actualmente, ofrece soporte para **Binance** y **Capital.com**, con una arquitectura que facilita la adición de nuevos brokers.

## ✨ Características

- **Soporte Multi-Broker:** Conecta y opera en Binance y Capital.com a través de una única API.
- **Base de Datos Persistente:** Utiliza MongoDB con Mongoose y Typegoose para registrar todos los movimientos y posiciones de trading.
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

## ⚙️ API Endpoints

Aquí están los endpoints disponibles en la API:

| Método | Ruta                  | Descripción                                                              | Body (Payload) de Ejemplo                                    |
|--------|-----------------------|--------------------------------------------------------------------------|--------------------------------------------------------------|
| `GET`  | `/`                   | Endpoint de health check para verificar si el servidor está activo.      | N/A                                                          |
| `GET`  | `/capital_balance`    | Obtiene el balance de la cuenta de Capital.com.                          | N/A                                                          |
| `POST` | `/capital_position`   | Abre o cierra una posición en Capital.com.                               | `{ "epic": "BTCUSD", "size": 0.01, "type": "buy", "strategy": "ema_cross" }` |
| `POST` | `/binance`            | Abre o cierra una posición en Binance.                                   | `{ "type": "BUY" }`                                          |

## 🧪 Testing

Para ejecutar la suite de tests, utiliza el siguiente comando:

```sh
npm test
```