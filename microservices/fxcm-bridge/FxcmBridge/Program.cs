using fxcore2;
using System.Runtime.InteropServices;
using System.Collections.Concurrent;
using System.Reflection;

var builder = WebApplication.CreateBuilder(args);

// --- 1. CARGA DE VARIABLES ---
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

// --- 2. INICIALIZACIÓN ---
O2GSession session = O2GTransport.createSession();
session.useTableManager(O2GTableManagerMode.Yes, null);

var pendingOrders = new ConcurrentDictionary<string, TaskCompletionSource<string>>();

// --- 3. WATCHER DE TABLAS (Captura el TradeID al abrir) ---
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

// Gestor de sesión en segundo plano
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
app.MapPost("/fxcm/order", async (HttpRequest req) =>
{
    try
    {
        using var doc = await System.Text.Json.JsonDocument.ParseAsync(req.Body);
        var root = doc.RootElement;
        string symbol = root.GetProperty("symbol").GetString()!;
        string side = root.GetProperty("side").GetString()!;
        double size = root.GetProperty("size").GetDouble();

        var tm = session.getTableManager();
        var accTable = (O2GAccountsTable)tm.getTable(O2GTableType.Accounts);
        var offTable = (O2GOffersTable)tm.getTable(O2GTableType.Offers);
        
        string accountId = accTable.getRow(0).AccountID;
        string? offerId = null;
        for (int i = 0; i < offTable.Count; i++) {
            if (offTable.getRow(i).Instrument.Equals(symbol, StringComparison.OrdinalIgnoreCase)) {
                offerId = offTable.getRow(i).OfferID;
                break;
            }
        }

        var factory = session.getRequestFactory();
        var valueMap = factory.createValueMap();
        valueMap.setString(O2GRequestParamsEnum.Command, "CreateOrder");
        valueMap.setString(O2GRequestParamsEnum.OrderType, "OM");
        valueMap.setString(O2GRequestParamsEnum.AccountID, accountId);
        valueMap.setString(O2GRequestParamsEnum.OfferID, offerId!);
        valueMap.setString(O2GRequestParamsEnum.BuySell, side.ToUpper() == "BUY" ? "B" : "S");
        valueMap.setInt(O2GRequestParamsEnum.Amount, (int)(size * 100)); 
        valueMap.setString(O2GRequestParamsEnum.CustomID, "bot_" + DateTime.Now.Ticks);

        O2GRequest request = factory.createOrderRequest(valueMap);
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

// --- 5. ENDPOINT: CIERRE (CON CAPTURA DE RESULTADOS) ---
app.MapPost("/fxcm/close", async (HttpRequest req) =>
{
    try
    {
        using var doc = await System.Text.Json.JsonDocument.ParseAsync(req.Body);
        var tradeId = doc.RootElement.GetProperty("tradeId").GetString();

        var tm = session.getTableManager();
        var tradesTable = (O2GTradesTable)tm.getTable(O2GTableType.Trades);
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
        valueMap.setString(O2GRequestParamsEnum.OrderType, Constants.Orders.TrueMarketClose); // "TMC"
        valueMap.setString(O2GRequestParamsEnum.AccountID, row.AccountID);
        valueMap.setString(O2GRequestParamsEnum.OfferID, row.OfferID);
        valueMap.setString(O2GRequestParamsEnum.TradeID, tradeId); 
        valueMap.setString(O2GRequestParamsEnum.BuySell, row.BuySell == "B" ? "S" : "B");
        valueMap.setInt(O2GRequestParamsEnum.Amount, row.Amount);

        O2GRequest request = factory.createOrderRequest(valueMap);
        session.sendRequest(request);

        // --- ESPERAR RESULTADOS FINALES ---
        double openPrice = 0, closePrice = 0, grossPL = 0, netPL = 0;
        bool found = false;

        for (int attempt = 0; attempt < 10; attempt++) {
            await Task.Delay(500); // Esperar medio segundo
            var closedTable = (O2GClosedTradesTable)tm.getTable(O2GTableType.ClosedTrades);
            for (int i = 0; i < closedTable.Count; i++) {
                var cRow = closedTable.getRow(i);
                if (cRow.TradeID == tradeId) {
                    openPrice = cRow.OpenRate;
                    closePrice = cRow.CloseRate;
                    grossPL = cRow.GrossPL;
                    netPL = cRow.GrossPL + cRow.Commission;
                    found = true;
                    break;
                }
            }
            if (found) break;
        }

        return Results.Ok(new { 
            success = true, 
            tradeId = tradeId,
            data = found ? new { openPrice, closePrice, grossPL, netPL } : null 
        });
    }
    catch (Exception ex) { return Results.BadRequest(new { success = false, error = ex.Message }); }
});

var portEnv = Environment.GetEnvironmentVariable("PORT");
var port = string.IsNullOrEmpty(portEnv) ? "5000" : portEnv;
app.Run($"http://0.0.0.0:{port}");

// --- ENDPOINT: HEALTHCHECK (GET /fxcm/health) ---
app.MapGet("/fxcm/health", () =>
{
    var status = session.getSessionStatus();
    return Results.Ok(new { connected = status == O2GSessionStatusCode.Connected, status = status.ToString() });
});