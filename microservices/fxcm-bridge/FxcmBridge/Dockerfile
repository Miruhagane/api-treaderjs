FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish -c Release -o /app/out

FROM mcr.microsoft.com/dotnet/aspnet:8.0
# Instalamos dependencias de red y seguridad para Linux
RUN apt-get update && apt-get install -y libicu-dev libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/out .

# Exponemos el puerto que usa Railway
ENV ASPNETCORE_URLS=http://+:5000
EXPOSE 5000

ENTRYPOINT ["dotnet", "FxcmBridge.dll"]