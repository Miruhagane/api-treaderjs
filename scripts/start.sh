#!/bin/bash

# 1. Iniciar Bridge .NET en segundo plano
echo "🚀 Iniciando Bridge FXCM (.NET) en puerto 5000..."

# Forzamos a .NET a usar el puerto 5000 para que no choque con Node
export ASPNETCORE_URLS=http://0.0.0.0:5000

# Ejecutamos desde su carpeta para que encuentre sus archivos de configuración
cd /app/dotnet-bridge && dotnet FxcmBridge.dll &

# Esperar a que el Bridge levante (las librerías nativas tardan un poco)
echo "⏳ Esperando al Bridge..."
sleep 5

# 2. Iniciar API Principal (Node.js)
echo "🌐 Iniciando API Principal (Node.js)..."
# Regresamos a la raíz donde está el package.json
cd /app && npm start || tail -f /dev/null