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

// --- 3. WATCHER DE TABLAS (Captura TradeID) ---
async Task WatchTablesAsync(ConcurrentDictionary<string, TaskCompletionSource<string>> pending, O2GSession sess)
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
            }
        }
        catch { }
        await Task.Delay(1000);
    }
}
_ = Task.Run(() => WatchTablesAsync(pendingOrders, session));

// Bucle de Reconexión
async Task SessionManagerLoopAsync()
{
    while (true)
    {
        try
        {
            if (session.getSessionStatus() != O2GSessionStatusCode.Connected)
            {
                var user = Environment.GetEnvironmentVariable("FXCM_USER");
                var pass = Environment.GetEnvironmentVariable("FXCM_PASS");
                if (!string.IsNullOrEmpty(user) && !string.IsNullOrEmpty(pass))
                {
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
// Node.js debe enviar: { "symbol": "XAG/USD", "side": "buy", "size": 1.6 }
app.MapPost("/fxcm/order", async (HttpRequest req) =>
{
    try
    {
        using var doc = await System.Text.Json.JsonDocument.ParseAsync(req.Body);
        var root = doc.RootElement;
        
        string symbol = root.GetProperty("symbol").GetString()!;
        string side   = root.GetProperty("side").GetString()!;
        double size   = root.GetProperty("size").GetDouble();

        var tm = session.getTableManager();
        if (tm == null || tm.getStatus() != O2GTableManagerStatus.TablesLoaded)
            throw new Exception("FXCM TableManager no está listo.");

        // Seguridad: Validar existencia de cuenta
        var accTable = (O2GAccountsTable)tm.getTable(O2GTableType.Accounts);
        if (accTable.Count == 0) throw new Exception("No hay cuentas cargadas.");
        string accountId = accTable.getRow(0).AccountID;

        // Seguridad: Buscar el OfferID exacto
        var offTable = (O2GOffersTable)tm.getTable(O2GTableType.Offers);
        string? offerId = null;
        for (int i = 0; i < offTable.Count; i++) {
            var row = offTable.getRow(i);
            if (row.Instrument.Equals(symbol, StringComparison.OrdinalIgnoreCase)) {
                offerId = row.OfferID;
                break;
            }
        }

        if (string.IsNullOrEmpty(offerId)) throw new Exception($"Símbolo '{symbol}' no encontrado.");

        var factory = session.getRequestFactory();
        var valueMap = factory.createValueMap();
        valueMap.setString(O2GRequestParamsEnum.Command, "CreateOrder");
        valueMap.setString(O2GRequestParamsEnum.OrderType, "OM");
        valueMap.setString(O2GRequestParamsEnum.AccountID, accountId);
        valueMap.setString(O2GRequestParamsEnum.OfferID, offerId);
        valueMap.setString(O2GRequestParamsEnum.BuySell, side.ToLower() == "buy" ? "B" : "S");
        valueMap.setInt(O2GRequestParamsEnum.Amount, (int)(size * 100)); 
        valueMap.setString(O2GRequestParamsEnum.CustomID, "bot_" + DateTime.Now.Ticks);

        O2GRequest request = factory.createOrderRequest(valueMap);
        if (request == null) throw new Exception("Error interno al crear el request (factory return null).");
        
        session.sendRequest(request);

        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        pendingOrders[request.RequestID] = tcs;
        var completed = await Task.WhenAny(tcs.Task, Task.Delay(20000));
        string? dealId = (completed == tcs.Task) ? await tcs.Task : null;
        pendingOrders.TryRemove(request.RequestID, out _);

        return Results.Ok(new { success = true, orderId = request.RequestID, dealId = dealId });
    }
    catch (Exception ex) { return Results.BadRequest(new { success = false, error = ex.Message }); }
});

// --- 5. ENDPOINT: CERRAR ORDEN ---
app.MapPost("/fxcm/close", async (HttpRequest req) =>
{
    try
    {
        using var doc = await System.Text.Json.JsonDocument.ParseAsync(req.Body);
        var tradeId = doc.RootElement.GetProperty("tradeId").GetString();

        var tm = session.getTableManager();
        var tradesTable = (O2GTradesTable)tm?.getTable(O2GTableType.Trades)!;
        O2GTradeRow? row = null;

        for (int i = 0; i < tradesTable.Count; i++) {
            if (tradesTable.getRow(i).TradeID == tradeId) {
                row = tradesTable.getRow(i);
                break;
            }
        }

        if (row == null) throw new Exception($"No se encontró el TradeID {tradeId}");

        var factory = session.getRequestFactory();
        var valueMap = factory.createValueMap();
        valueMap.setString(O2GRequestParamsEnum.Command, "CreateOrder");
        valueMap.setString(O2GRequestParamsEnum.OrderType, "TMC"); 
        valueMap.setString(O2GRequestParamsEnum.AccountID, row.AccountID);
        valueMap.setString(O2GRequestParamsEnum.OfferID, row.OfferID);
        valueMap.setString(O2GRequestParamsEnum.TradeID, tradeId); 
        valueMap.setString(O2GRequestParamsEnum.BuySell, row.BuySell == "B" ? "S" : "B");
        valueMap.setInt(O2GRequestParamsEnum.Amount, row.Amount);

        O2GRequest request = factory.createOrderRequest(valueMap);
        session.sendRequest(request);

        return Results.Ok(new { success = true, tradeId = tradeId });
    }
    catch (Exception ex) { return Results.BadRequest(new { success = false, error = ex.Message }); }
});

app.MapGet("/fxcm/health", () => Results.Ok(new { 
    connected = session.getSessionStatus() == O2GSessionStatusCode.Connected,
    tables = session.getTableManager()?.getStatus().ToString()
}));

app.Run("http://0.0.0.0:5000");