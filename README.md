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

## ⚙️ API Endpoints

Aquí están los endpoints disponibles en la API:

| Método | Ruta                  | Descripción                                                              | Body (Payload) de Ejemplo                                    |
|--------|-----------------------|--------------------------------------------------------------------------|--------------------------------------------------------------|
| `GET`  | `/`                   | Endpoint de health check para verificar si el servidor está activo.      | N/A                                                          |
| `GET`  | `/capital_balance`    | Obtiene el balance de la cuenta de Capital.com.                          | N/A                                                          |
| `GET`  | `/capital_active`     | Verifica el estado de la sesión con Capital.com y devuelve los tokens.   | N/A                                                          |
| `POST` | `/capital_position`   | Abre o cierra una posición en Capital.com.                               | `{ "epic": "BTCUSD", "size": 0.01, "type": "buy", "strategy": "ema_cross" }` |
| `POST` | `/binance`            | Abre o cierra una posición en Binance.                                   | `{ "type": "BUY", "strategy": "mi_estrategia" }`             |

## 🧪 Testing

Para ejecutar la suite de tests, utiliza el siguiente comando:

```sh
npm test
```

## 🏛️ Arquitectura y Decisiones de Diseño

### Gestión de Sesión y Tokens

Para evitar exceder los límites de solicitudes de la API de Capital.com y mejorar la eficiencia, se ha implementado un sistema de gestión de sesiones que utiliza la base de datos como caché.

- **Modelo `Token`:** Se ha creado un modelo en `src/config/models/tokens.ts` que almacena los tokens de sesión (`CST` y `X-SECURITY-TOKEN`) junto con un `timestamp`.
- **`sessionManager.ts`:** Este módulo (`src/config/sessionManager.ts`) se encarga de:
  1.  Verificar si existe un token válido y no expirado en la base de datos.
  2.  Si existe, lo devuelve para ser utilizado en las solicitudes a la API.
  3.  Si no existe o ha expirado, solicita nuevos tokens a Capital.com, los guarda (o actualiza) en la base de datos y los devuelve.

Este enfoque centralizado reduce drásticamente el número de inicios de sesión, solucionando el problema de `error.too-many.requests` y haciendo que la API sea más robusta y rápida.
