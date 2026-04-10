# --- ETAPA 1: Compilar .NET ---
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS dotnet-build
WORKDIR /src
COPY microservices/fxcm-bridge/FxcmBridge/FxcmBridge.csproj ./microservices/fxcm-bridge/FxcmBridge/
RUN dotnet restore ./microservices/fxcm-bridge/FxcmBridge/FxcmBridge.csproj
COPY . .
RUN dotnet publish ./microservices/fxcm-bridge/FxcmBridge/FxcmBridge.csproj -c Release -o /app/dotnet-out

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
COPY . .

# --- CONFIGURACIÓN CRÍTICA ---
# Ahora que movimos los archivos, la ruta principal es suficiente
ENV LD_LIBRARY_PATH="/app/dotnet-bridge:/usr/lib"

# Permisos de ejecución para el script y las librerías nativas
RUN chmod +x /app/dotnet-bridge/*.so* && chmod +x ./scripts/start.sh

CMD ["./scripts/start.sh"]