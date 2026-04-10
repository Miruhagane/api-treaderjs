#!/bin/bash

# 1. Iniciar Bridge .NET en segundo plano
echo "🚀 Iniciando Bridge FXCM (.NET)..."
# Según tu Dockerfile, el bridge compilado está en /app/dotnet-bridge
cd /app/dotnet-bridge && dotnet FxcmBridge.dll &

# Esperar a que el Bridge levante (las librerías nativas tardan un poco)
echo "⏳ Esperando al Bridge..."
sleep 5

# 2. Iniciar API Principal (Node.js)
echo "🌐 Iniciando API Principal (Node.js)..."
# Tu package.json está en la raíz /app, por eso entramos directamente ahí
cd /app && npm start || tail -f /dev/null