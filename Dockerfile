# --- ETAPA 1: Compilar .NET ---
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS dotnet-build
WORKDIR /src
COPY microservices/fxcm-bridge/FxcmBridge/FxcmBridge.csproj ./microservices/fxcm-bridge/FxcmBridge/
RUN dotnet restore ./microservices/fxcm-bridge/FxcmBridge/FxcmBridge.csproj
COPY . .
RUN dotnet publish ./microservices/fxcm-bridge/FxcmBridge/FxcmBridge.csproj -c Release -o /app/dotnet-out

# --- ETAPA 1.5: Compilar Node (TypeScript) ---
FROM node:20-bullseye-slim AS node-builder
WORKDIR /app

# Copiar package files e instalar dependencias (incluye dev para build)
COPY package*.json ./
RUN npm ci

# Copiar el resto y compilar TypeScript
COPY . .
RUN npm run build

# --- ETAPA 2: Runtime Final ---
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final

# Instalar Node.js y dependencias de sistema
RUN apt-get update && apt-get install -y \
    curl \
    libicu-dev \
    libssl-dev \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Copiar el Bridge compilado
COPY --from=dotnet-build /app/dotnet-out ./dotnet-bridge

# --- AJUSTE CLAVE PARA FXCM ---
# Entramos a la carpeta del bridge y movemos todos los .so de las subcarpetas a la raíz
# Esto soluciona el DllNotFoundException de raíz
RUN cd /app/dotnet-bridge && find . -name "*.so*" -exec cp {} . \;
# ----------------------------

# 2. Configurar Node.js
COPY package*.json ./
RUN npm install --production
# Copy runtime files and compiled JS from node build stage
# (we build Node app in a separate stage to produce /app/dist)
COPY --from=node-builder /app/dist ./dist
COPY . .

# --- CONFIGURACIÓN CRÍTICA ---
# Ahora que movimos los archivos, la ruta principal es suficiente
ENV LD_LIBRARY_PATH="/app/dotnet-bridge:/usr/lib"

# Permisos de ejecución para el script y las librerías nativas
RUN chmod +x /app/dotnet-bridge/*.so* && chmod +x ./scripts/start.sh

CMD ["./scripts/start.sh"]