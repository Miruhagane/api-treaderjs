using fxcore2;
using System.Runtime.InteropServices;
using System.Collections.Concurrent;

var builder = WebApplication.CreateBuilder(args);

// --- 1. CARGA DE VARIABLES (.env) ---
string currentDir = Directory.GetCurrentDirectory();
string envPath = Path.GetFullPath(Path.Combine(currentDir, "../../../.env"));
if (File.Exists(envPath))
{
    foreach (var line in File.ReadAllLines(envPath))
    {
        if (string.IsNullOrWhiteSpace(line) || line.StartsWith("#")) continue;
        var parts = line.Split('=', 2);
        if (parts.Length == 2) Environment.SetEnvironmentVariable(parts[0].Trim(), parts[1].Trim());
    }
}

var app = builder.Build();

// --- 2. INICIALIZACIÓN DE FXCM ---
O2GSession session = O2GTransport.createSession();
session.useTableManager(O2GTableManagerMode.Yes, null);

var pendingOrders = new ConcurrentDictionary<string, TaskCompletionSource<string>>();
var pendingCloses = new ConcurrentDictionary<string, TaskCompletionSource<ClosedTradeInfo>>();

// --- 3. WATCHER DE TABLAS (Captura TradeID y cierres para confirmación) ---
async Task WatchTablesAsync(ConcurrentDictionary<string, TaskCompletionSource<string>> pending, ConcurrentDictionary<string, TaskCompletionSource<ClosedTradeInfo>> pendingCls, O2GSession sess)
{
    while (true)
    {
        try
        {
            var tm = sess.getTableManager();
            if (tm != null && tm.getStatus() == O2GTableManagerStatus.TablesLoaded)
            {
                var tradesTable = (O2GTradesTable)tm.getTable(O2GTableType.Trades);
                if (tradesTable != null)
                {
                    for (int i = 0; i < tradesTable.Count; i++)
                    {
                        var row = tradesTable.getRow(i);
                        string requestId = row.OpenOrderReqID;
                        if (!string.IsNullOrEmpty(requestId) && pending.TryGetValue(requestId, out var tcs))
                            tcs.TrySetResult(row.TradeID);
                    }
                }

                var closedTable = (O2GClosedTradesTable)tm.getTable(O2GTableType.ClosedTrades);
                if (closedTable != null)
                {
                    for (int i = 0; i < closedTable.Count; i++)
                    {
                        var row = closedTable.getRow(i);
                        if (pendingCls.TryGetValue(row.TradeID, out var tcs))
                        {
                            tcs.TrySetResult(new ClosedTradeInfo(row.OpenRate, row.CloseRate, row.NetPL));
                        }
                    }
                }
            }
        }
        catch { /* Silenciar errores de lectura de tabla */ }
        await Task.Delay(1000);
    }
}
_ = Task.Run(() => WatchTablesAsync(pendingOrders, pendingCloses, session));

// Bucle de Reconexión Automática
async Task SessionManagerLoopAsync()
{
    while (true)
    {
        try
        {
            if (session.getSessionStatus() != O2GSessionStatusCode.Connected && 
                session.getSessionStatus() != O2GSessionStatusCode.Connecting)
            {
                var user = Environment.GetEnvironmentVariable("FXCM_USER");
                var pass = Environment.GetEnvironmentVariable("FXCM_PASS");
                if (!string.IsNullOrEmpty(user) && !string.IsNullOrEmpty(pass))
                {
                    Console.WriteLine("[FXCM] Intentando conectar...");
                    session.login(user, pass, "http://www.fxcorporate.com/Hosts.jsp", "Demo");
                }
            }
        }
        catch (Exception ex) { Console.WriteLine($"[SessionLoop] Error: {ex.Message}"); }
        await Task.Delay(10000);
    }
}
_ = Task.Run(() => SessionManagerLoopAsync());

// --- 4. ENDPOINT: ABRIR ORDEN ---
app.MapPost("/fxcm/order", async (HttpRequest req) =>
{
    try
    {
        Console.WriteLine( req.Path + " - Nueva solicitud de orden recibida." );
        using var doc = await System.Text.Json.JsonDocument.ParseAsync(req.Body);
        var root = doc.RootElement;
        
        string symbol = root.GetProperty("symbol").GetString()!;
        string side   = root.GetProperty("side").GetString()!;
        double size   = root.GetProperty("size").GetDouble(); // Ej: 1.0 para 1k

        var tm = session.getTableManager();
        if (tm == null || tm.getStatus() != O2GTableManagerStatus.TablesLoaded)
            throw new Exception("FXCM TableManager no está listo o las tablas no han cargado.");

        // Obtener ID de cuenta
        var accTable = (O2GAccountsTable)tm.getTable(O2GTableType.Accounts);
        if (accTable.Count == 0) throw new Exception("No hay cuentas disponibles.");
        string accountId = accTable.getRow(0).AccountID;

        // Buscar OfferID y BaseUnitSize
        var offTable = (O2GOffersTable)tm.getTable(O2GTableType.Offers);
        string? offerId = null;
        for (int i = 0; i < offTable.Count; i++) {
            var row = offTable.getRow(i);
            if (row.Instrument.Equals(symbol, StringComparison.OrdinalIgnoreCase)) {
                offerId = row.OfferID;
                break;
            }
        }

        if (string.IsNullOrEmpty(offerId)) throw new Exception($"Símbolo '{symbol}' no encontrado en FXCM.");

        var factory = session.getRequestFactory();
        if (factory == null) throw new Exception("No se pudo crear el Request Factory.");

        var valueMap = factory.createValueMap();
        valueMap.setString(O2GRequestParamsEnum.Command, Constants.Commands.CreateOrder);
        valueMap.setString(O2GRequestParamsEnum.OrderType, Constants.Orders.MarketOpen); // Orden de Mercado
        valueMap.setString(O2GRequestParamsEnum.AccountID, accountId);
        valueMap.setString(O2GRequestParamsEnum.OfferID, offerId);
        valueMap.setString(O2GRequestParamsEnum.BuySell, side.ToLower() == "buy" ? "B" : "S");
        
        // CORRECCIÓN: FXCM usa cantidades enteras (1000 = 1 micro lote).
        // Si 'size' desde Node es 1.0, enviamos 1000.
        
        valueMap.setInt(O2GRequestParamsEnum.Amount, (int)(size)); 
        
        valueMap.setString(O2GRequestParamsEnum.CustomID, "bot_" + DateTime.Now.Ticks);

        O2GRequest request = factory.createOrderRequest(valueMap);
        if (request == null) {
            throw new Exception($"Error al crear request: {factory.getLastError()}");
        }
        
        session.sendRequest(request);

        // Esperar confirmación de la tabla de Trades (opcional, timeout 20s)
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        pendingOrders[request.RequestID] = tcs;
        var completed = await Task.WhenAny(tcs.Task, Task.Delay(20000));
        
        string? dealId = (completed == tcs.Task) ? await tcs.Task : null;
        pendingOrders.TryRemove(request.RequestID, out _);

        return Results.Ok(new { 
            success = true, 
            orderId = request.RequestID, 
            dealId = dealId,
            msg = dealId == null ? "Orden enviada pero no confirmada en tabla aún." : "Ejecutada"
        });
    }
    catch (Exception ex) { 
        Console.WriteLine($"[Order Error] {ex.Message}");
        return Results.BadRequest(new { success = false, error = ex.Message }); 
    }
});

// --- 5. ENDPOINT: CERRAR ORDEN ---
app.MapPost("/fxcm/close", async (HttpRequest req) =>
{
    try
    {
        using var doc = await System.Text.Json.JsonDocument.ParseAsync(req.Body);
        var tradeId = doc.RootElement.GetProperty("tradeId").ToString();

        var tm = session.getTableManager();
        if (tm == null) throw new Exception("TableManager no disponible.");
        
        var tradesTable = (O2GTradesTable)tm.getTable(O2GTableType.Trades);
        O2GTradeRow? row = null;

        for (int i = 0; i < tradesTable.Count; i++) {
            if (tradesTable.getRow(i).TradeID == tradeId) {
                row = tradesTable.getRow(i);
                break;
            }
        }

        if (row == null) throw new Exception($"No se encontró una posición abierta con ID {tradeId}");

        var factory = session.getRequestFactory();
        var valueMap = factory.createValueMap();
        valueMap.setString(O2GRequestParamsEnum.Command, Constants.Commands.CreateOrder);
        valueMap.setString(O2GRequestParamsEnum.OrderType, Constants.Orders.TrueMarketClose); // True Market Close
        valueMap.setString(O2GRequestParamsEnum.AccountID, row.AccountID);
        valueMap.setString(O2GRequestParamsEnum.OfferID, row.OfferID);
        valueMap.setString(O2GRequestParamsEnum.TradeID, tradeId); 
        valueMap.setString(O2GRequestParamsEnum.BuySell, row.BuySell == "B" ? "S" : "B");
        valueMap.setInt(O2GRequestParamsEnum.Amount, row.Amount);

        O2GRequest request = factory.createOrderRequest(valueMap);
        if (request == null) throw new Exception($"Error al crear cierre: {factory.getLastError()}");

        // Registrar espera de cierre
        var tcs = new TaskCompletionSource<ClosedTradeInfo>(TaskCreationOptions.RunContinuationsAsynchronously);
        pendingCloses[tradeId] = tcs;

        session.sendRequest(request);

        // Esperar confirmación de cierre (timeout 20s)
        var completed = await Task.WhenAny(tcs.Task, Task.Delay(20000));
        ClosedTradeInfo? info = (completed == tcs.Task) ? await tcs.Task : null;
        pendingCloses.TryRemove(tradeId, out _);

        return Results.Ok(new { 
            success = true, 
            tradeId = tradeId, 
            openPrice = info?.OpenPrice ?? 0,
            closePrice = info?.ClosePrice ?? 0,
            netPL = info?.NetPL ?? 0,
            status = info == null ? "Cierre enviado pero no confirmado en tabla aún." : "Cerrada" 
        });
    }
    catch (Exception ex) { 
        return Results.BadRequest(new { success = false, error = ex.Message }); 
    }
});

app.MapGet("/fxcm/health", () => Results.Ok(new { 
    connected = session.getSessionStatus() == O2GSessionStatusCode.Connected,
    tables = session.getTableManager()?.getStatus().ToString()
}));

app.Run("http://0.0.0.0:5000");

// --- CLASE DE CONSTANTES (Según Documentación FXCM) ---
public static class Constants
{
    public static class Commands
    {
        public const string CreateOrder = "CreateOrder";
        public const string EditOrder   = "EditOrder";
        public const string DeleteOrder = "DeleteOrder";
    }
    public static class Orders
    {
        public const string MarketOpen       = "OM";
        public const string TrueMarketClose  = "CM";
        public const string MarketClose      = "CM";
        public const string LimitOpen        = "OL";
        public const string StopOpen         = "OS";
    }
}

public record ClosedTradeInfo(double OpenPrice, double ClosePrice, double NetPL);