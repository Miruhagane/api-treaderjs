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

# Asegúrate de que package-lock.json existe localmente. 
# Si no existe, usa "RUN npm install" en lugar de "npm ci"
COPY package*.json ./
RUN npm ci || npm install

# Copiamos todo para compilar
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

# Ajuste de librerías nativas .so
RUN cd /app/dotnet-bridge && find . -name "*.so*" -exec cp {} . \;

# 2. Configurar Node.js para producción
COPY package*.json ./
# Instalamos solo producción para ahorrar espacio
RUN npm install --production

# --- SOLUCIÓN AL MODULE_NOT_FOUND ---
# Primero copiamos el código compilado (dist) desde el builder
COPY --from=node-builder /app/dist ./dist
# Luego copiamos el resto de los archivos necesarios (como la carpeta scripts)
# OJO: No copies "." aquí si eso sobrescribirá tu carpeta "dist" vacía del host
COPY . .

# --- CONFIGURACIÓN CRÍTICA ---
ENV LD_LIBRARY_PATH="/app/dotnet-bridge:/usr/lib"

# Permisos
RUN chmod +x /app/dotnet-bridge/*.so* 2>/dev/null || true
# Aseguramos que el script de inicio tenga permisos
RUN chmod +x ./scripts/start.sh

CMD ["./scripts/start.sh"]