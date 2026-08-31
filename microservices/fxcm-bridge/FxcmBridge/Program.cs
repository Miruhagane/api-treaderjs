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

// Diccionarios de espera. Para aperturas se mapea RequestID -> TradeID.
// Para cierres se mapea RequestID -> resultado, porque el callback
// de respuesta del request es la fuente de verdad (no la tabla ClosedTrades).
var pendingOrders = new ConcurrentDictionary<string, TaskCompletionSource<string>>();
var pendingCloses = new ConcurrentDictionary<string, TaskCompletionSource<CloseResult>>();

// --- 3. LISTENERS DE RESPUESTA DE FXCM (fuente de verdad) ---
session.RequestCompleted += (sender, e) =>
{
    try
    {
        var response = e.Response;
        if (response == null) return;

        // El servidor aceptó la request. NO completamos el TCS todavía:
        // la confirmación final del cierre llega cuando aparece la fila en
        // la tabla ClosedTrades (manejada por el watcher). Si marcáramos
        // el TCS como completado aquí, el cliente recibiría confirmed=false
        // y reintentaría el cierre, lo cual sería rechazado por FXCM con
        // "trade not found" porque ya estaría cerrado.
        if (pendingCloses.ContainsKey(e.RequestID))
        {
            Console.WriteLine($"[FXCM] RequestCompleted reqId={e.RequestID} -> cierre ACEPTADO por servidor, esperando tabla ClosedTrades");
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[FXCM] RequestCompleted handler error: {ex.Message}");
    }
};

session.RequestFailed += (sender, e) =>
{
    try
    {
        Console.WriteLine($"[FXCM] RequestFailed reqId={e.RequestID} error={e.Error}");
        if (pendingCloses.TryRemove(e.RequestID, out var tcs))
        {
            tcs.TrySetResult(new CloseResult
            {
                Accepted = false,
                Error = e.Error,
                Status = "Rechazado por servidor FXCM"
            });
        }
        if (pendingOrders.TryRemove(e.RequestID, out var otcs))
        {
            otcs.TrySetException(new Exception($"FXCM rechazó la orden: {e.Error}"));
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[FXCM] RequestFailed handler error: {ex.Message}");
    }
};

session.SessionStatusChanged += (sender, e) =>
{
    Console.WriteLine($"[FXCM] SessionStatusChanged -> {e.SessionStatus}");
};

session.TableManagerStatusChanged += (sender, e) =>
{
    Console.WriteLine($"[FXCM] TableManagerStatusChanged -> {session.getTableManager()?.getStatus()}");
};

// --- 4. WATCHER DE TABLAS (confirmación secundaria vía ClosedTrades) ---
async Task WatchTablesAsync(
    ConcurrentDictionary<string, TaskCompletionSource<string>> pending,
    ConcurrentDictionary<string, TaskCompletionSource<CloseResult>> pendingCls,
    O2GSession sess)
{
    while (true)
    {
        try
        {
            var tm = sess.getTableManager();
            if (tm != null && tm.getStatus() == O2GTableManagerStatus.TablesLoaded)
            {
                // Confirmar aperturas: mapear requestId -> TradeID
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

                // Confirmar cierres: cuando la fila aparece en ClosedTrades,
                // extraer precios y completar el TCS con un resultado definitivo.
                var closedTable = (O2GClosedTradesTable)tm.getTable(O2GTableType.ClosedTrades);
                if (closedTable != null)
                {
                    for (int i = 0; i < closedTable.Count; i++)
                    {
                        var row = closedTable.getRow(i);
                        if (pendingCls.TryGetValue(row.TradeID, out var tcs))
                        {
                            // El resultado se sobreescribe con la info real del cierre.
                            tcs.TrySetResult(new CloseResult
                            {
                                Accepted = true,
                                Error = null,
                                OpenPrice = row.OpenRate,
                                ClosePrice = row.CloseRate,
                                NetPL = row.NetPL,
                                Amount = row.Amount,
                                Status = "Cerrada y confirmada en tabla"
                            });
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
            var status = session.getSessionStatus();
            if (status != O2GSessionStatusCode.Connected &&
                status != O2GSessionStatusCode.Connecting)
            {
                var user = Environment.GetEnvironmentVariable("FXCM_USER");
                var pass = Environment.GetEnvironmentVariable("FXCM_PASS");
                var env = Environment.GetEnvironmentVariable("FXCM_ENV") ?? "Demo";
                if (!string.IsNullOrEmpty(user) && !string.IsNullOrEmpty(pass))
                {
                    Console.WriteLine($"[FXCM] Intentando conectar a entorno: {env} (status previo: {status})...");
                    session.login(user, pass, "http://www.fxcorporate.com/Hosts.jsp", env);
                }
            }
        }
        catch (Exception ex) { Console.WriteLine($"[SessionLoop] Error: {ex.Message}"); }
        await Task.Delay(10000);
    }
}
_ = Task.Run(() => SessionManagerLoopAsync());

// --- 5. UTILIDADES ---

// Espera activa (máx. timeoutMs) hasta que TableManager llegue a TablesLoaded.
// Devuelve true si llegó, false si se agotó el tiempo.
async Task<bool> WaitForTablesLoadedAsync(O2GSession sess, int timeoutMs, int pollMs = 200)
{
    var sw = System.Diagnostics.Stopwatch.StartNew();
    while (sw.ElapsedMilliseconds < timeoutMs)
    {
        try
        {
            var tm = sess.getTableManager();
            if (tm != null && tm.getStatus() == O2GTableManagerStatus.TablesLoaded)
                return true;
        }
        catch { }
        await Task.Delay(pollMs);
    }
    return false;
}

// Búsqueda robusta de trade en la tabla Trades con reintentos.
// Cubre la ventana en que las tablas están siendo recargadas tras reconexión.
async Task<O2GTradeRow?> FindTradeRowAsync(O2GSession sess, string tradeId, int retries = 5, int backoffMs = 200)
{
    for (int attempt = 1; attempt <= retries; attempt++)
    {
        try
        {
            var tm = sess.getTableManager();
            if (tm == null || tm.getStatus() != O2GTableManagerStatus.TablesLoaded)
            {
                Console.WriteLine($"[Close] FindTradeRow attempt={attempt}: tablas no listas (status={tm?.getStatus()})");
                await Task.Delay(backoffMs);
                continue;
            }

            var tradesTable = (O2GTradesTable)tm.getTable(O2GTableType.Trades);
            if (tradesTable == null)
            {
                Console.WriteLine($"[Close] FindTradeRow attempt={attempt}: tabla Trades es null");
                await Task.Delay(backoffMs);
                continue;
            }

            for (int i = 0; i < tradesTable.Count; i++)
            {
                var row = tradesTable.getRow(i);
                if (row.TradeID == tradeId) return row;
            }

            Console.WriteLine($"[Close] FindTradeRow attempt={attempt}/{retries}: trade {tradeId} no encontrado en tabla");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Close] FindTradeRow attempt={attempt} error: {ex.Message}");
        }

        if (attempt < retries) await Task.Delay(backoffMs);
    }
    return null;
}

// --- 6. ENDPOINT: ABRIR ORDEN ---
app.MapPost("/fxcm/order", async (HttpRequest req) =>
{
    try
    {
        Console.WriteLine(req.Path + " - Nueva solicitud de orden recibida.");
        using var doc = await System.Text.Json.JsonDocument.ParseAsync(req.Body);
        var root = doc.RootElement;

        string symbol = root.GetProperty("symbol").GetString()!;
        string side = root.GetProperty("side").GetString()!;
        double size = root.GetProperty("size").GetDouble();

        if (session.getSessionStatus() != O2GSessionStatusCode.Connected)
            throw new Exception($"Sesión FXCM no conectada (status={session.getSessionStatus()}). Reintente en unos segundos.");

        if (!await WaitForTablesLoadedAsync(session, timeoutMs: 5000))
            throw new Exception("FXCM TableManager no llegó a TablesLoaded en 5s.");

        var tm = session.getTableManager();
        if (tm == null) throw new Exception("TableManager no disponible.");

        var accTable = (O2GAccountsTable)tm.getTable(O2GTableType.Accounts);
        if (accTable == null || accTable.Count == 0) throw new Exception("No hay cuentas disponibles.");
        string accountId = accTable.getRow(0).AccountID;

        var offTable = (O2GOffersTable)tm.getTable(O2GTableType.Offers);
        if (offTable == null) throw new Exception("Tabla Offers no disponible.");
        string? offerId = null;
        for (int i = 0; i < offTable.Count; i++)
        {
            var row = offTable.getRow(i);
            if (row.Instrument.Equals(symbol, StringComparison.OrdinalIgnoreCase))
            {
                offerId = row.OfferID;
                break;
            }
        }

        if (string.IsNullOrEmpty(offerId)) throw new Exception($"Símbolo '{symbol}' no encontrado en FXCM.");

        var factory = session.getRequestFactory();
        if (factory == null) throw new Exception("No se pudo crear el Request Factory.");

        var valueMap = factory.createValueMap();
        valueMap.setString(O2GRequestParamsEnum.Command, Constants.Commands.CreateOrder);
        valueMap.setString(O2GRequestParamsEnum.OrderType, Constants.Orders.MarketOpen);
        valueMap.setString(O2GRequestParamsEnum.AccountID, accountId);
        valueMap.setString(O2GRequestParamsEnum.OfferID, offerId);
        valueMap.setString(O2GRequestParamsEnum.BuySell, side.ToLower() == "buy" ? "B" : "S");
        valueMap.setInt(O2GRequestParamsEnum.Amount, (int)(size));
        valueMap.setString(O2GRequestParamsEnum.CustomID, "bot_" + DateTime.Now.Ticks);

        O2GRequest request = factory.createOrderRequest(valueMap);
        if (request == null)
        {
            throw new Exception($"Error al crear request: {factory.getLastError()}");
        }

        Console.WriteLine($"[Order] Enviando orden reqId={request.RequestID} symbol={symbol} side={side} size={size} account={accountId}");
        session.sendRequest(request);

        // Esperar confirmación de la tabla de Trades (opcional, timeout 20s)
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        pendingOrders[request.RequestID] = tcs;
        var completed = await Task.WhenAny(tcs.Task, Task.Delay(20000));

        string? dealId = (completed == tcs.Task) ? await tcs.Task : null;
        pendingOrders.TryRemove(request.RequestID, out _);

        return Results.Ok(new
        {
            success = true,
            orderId = request.RequestID,
            dealId = dealId,
            msg = dealId == null ? "Orden enviada pero no confirmada en tabla aún." : "Ejecutada"
        });
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Order Error] {ex.Message}");
        return Results.BadRequest(new { success = false, error = ex.Message });
    }
});

// --- 7. ENDPOINT: CERRAR ORDEN ---
app.MapPost("/fxcm/close", async (HttpRequest req) =>
{
    try
    {
        using var doc = await System.Text.Json.JsonDocument.ParseAsync(req.Body);
        var tradeId = doc.RootElement.GetProperty("tradeId").ToString();

        Console.WriteLine($"[Close] Solicitud de cierre recibida tradeId={tradeId} sessionStatus={session.getSessionStatus()} tmStatus={session.getTableManager()?.getStatus()}");

        // 1. Validar sesión
        if (session.getSessionStatus() != O2GSessionStatusCode.Connected)
        {
            throw new Exception($"Sesión FXCM no conectada (status={session.getSessionStatus()}). Reintente en unos segundos.");
        }

        // 2. Esperar a que las tablas estén cargadas (puede que se estén recargando tras reconexión)
        if (!await WaitForTablesLoadedAsync(session, timeoutMs: 5000))
        {
            throw new Exception("FXCM TableManager no llegó a TablesLoaded en 5s. Posible recarga de tablas en curso.");
        }

        // 3. Buscar el trade con reintentos (cubre la ventana de recarga de tablas)
        var row = await FindTradeRowAsync(session, tradeId, retries: 5, backoffMs: 200);
        if (row == null)
        {
            throw new Exception($"No se encontró una posición abierta con ID {tradeId} tras 5 intentos. Verifique que el trade existe y la cuenta coincide.");
        }

        // 4. Construir request de cierre
        var factory = session.getRequestFactory();
        if (factory == null) throw new Exception("No se pudo crear el Request Factory.");

        var valueMap = factory.createValueMap();
        valueMap.setString(O2GRequestParamsEnum.Command, Constants.Commands.CreateOrder);
        valueMap.setString(O2GRequestParamsEnum.OrderType, Constants.Orders.TrueMarketClose);
        valueMap.setString(O2GRequestParamsEnum.AccountID, row.AccountID);
        valueMap.setString(O2GRequestParamsEnum.OfferID, row.OfferID);
        valueMap.setString(O2GRequestParamsEnum.TradeID, tradeId);
        valueMap.setString(O2GRequestParamsEnum.BuySell, row.BuySell == "B" ? "S" : "B");
        valueMap.setInt(O2GRequestParamsEnum.Amount, row.Amount);
        valueMap.setString(O2GRequestParamsEnum.CustomID, "close_" + DateTime.Now.Ticks);

        O2GRequest request = factory.createOrderRequest(valueMap);
        if (request == null)
        {
            throw new Exception($"Error al crear cierre: {factory.getLastError()}");
        }

        Console.WriteLine($"[Close] Enviando cierre reqId={request.RequestID} tradeId={tradeId} account={row.AccountID} offerId={row.OfferID} side={row.BuySell}->{(row.BuySell == "B" ? "S" : "B")} amount={row.Amount}");

        // 5. Registrar espera de cierre
        var tcs = new TaskCompletionSource<CloseResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        // Mapear TANTO por tradeId (para que el watcher de ClosedTrades complete) COMO por requestId
        // (para que el listener de RequestCompleted/RequestFailed complete).
        // Usamos una clave compuesta serializada en JSON.
        pendingCloses[request.RequestID] = tcs;
        pendingCloses[tradeId] = tcs;

        session.sendRequest(request);

        // 6. Esperar resultado. El primero que dispare completa el TCS.
        //    - RequestFailed: el servidor rechazó la orden (rápido)
        //    - RequestCompleted: servidor aceptó, falta confirmación de tabla
        //    - Watcher de ClosedTrades: confirmación final con precios
        //    - Timeout 20s: última red de seguridad
        var completed = await Task.WhenAny(tcs.Task, Task.Delay(20000));
        CloseResult? result = (completed == tcs.Task) ? await tcs.Task : null;

        // Limpiar ambos keys
        pendingCloses.TryRemove(request.RequestID, out _);
        pendingCloses.TryRemove(tradeId, out _);

        // 7. Si el resultado no es definitivo (fue aceptado por servidor pero la
        //    tabla ClosedTrades aún no reflejó el cierre), devolver aceptado=true
        //    pero confirmed=false. El cliente decide si reintentar o confiar.
        bool confirmed = result != null
            && result.Accepted
            && result.Status == "Cerrada y confirmada en tabla";

        if (result == null)
        {
            Console.WriteLine($"[Close] Timeout 20s reqId={request.RequestID} tradeId={tradeId} - sin respuesta del servidor");
            return Results.BadRequest(new
            {
                success = false,
                confirmed = false,
                tradeId = tradeId,
                requestId = request.RequestID,
                error = "Timeout esperando respuesta de FXCM (20s)",
                status = "timeout"
            });
        }

        if (!result.Accepted)
        {
            Console.WriteLine($"[Close] Rechazado reqId={request.RequestID} tradeId={tradeId} error={result.Error}");
            return Results.BadRequest(new
            {
                success = false,
                confirmed = false,
                tradeId = tradeId,
                requestId = request.RequestID,
                error = result.Error ?? "Rechazado por servidor FXCM",
                status = "rejected"
            });
        }

        Console.WriteLine($"[Close] OK reqId={request.RequestID} tradeId={tradeId} confirmed={confirmed} openPrice={result.OpenPrice} closePrice={result.ClosePrice} netPL={result.NetPL}");

        return Results.Ok(new
        {
            success = true,
            confirmed = confirmed,
            tradeId = tradeId,
            requestId = request.RequestID,
            openPrice = result.OpenPrice,
            closePrice = result.ClosePrice,
            netPL = result.NetPL,
            amount = result.Amount,
            status = result.Status
        });
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Close Error] tradeId=? error={ex.Message}");
        return Results.BadRequest(new { success = false, confirmed = false, error = ex.Message });
    }
});

app.MapGet("/fxcm/health", () => Results.Ok(new
{
    connected = session.getSessionStatus() == O2GSessionStatusCode.Connected,
    sessionStatus = session.getSessionStatus().ToString(),
    tables = session.getTableManager()?.getStatus().ToString()
}));

app.Run("http://0.0.0.0:5000");

// --- CLASE DE CONSTANTES (Según Documentación FXCM) ---
public static class Constants
{
    public static class Commands
    {
        public const string CreateOrder = "CreateOrder";
        public const string EditOrder = "EditOrder";
        public const string DeleteOrder = "DeleteOrder";
    }
    public static class Orders
    {
        public const string MarketOpen = "OM";
        public const string TrueMarketClose = "CM";
        public const string MarketClose = "CM";
        public const string LimitOpen = "OL";
        public const string StopOpen = "OS";
    }
}

public record ClosedTradeInfo(double OpenPrice, double ClosePrice, double NetPL);

// Resultado completo de un intento de cierre. Lo completa:
//  - el listener RequestFailed -> Accepted=false
//  - el listener RequestCompleted -> Accepted=true (pero sin precios)
//  - el watcher de ClosedTrades -> Accepted=true con precios reales
public class CloseResult
{
    public bool Accepted { get; set; }
    public string? Error { get; set; }
    public string Status { get; set; } = "";
    public double OpenPrice { get; set; }
    public double ClosePrice { get; set; }
    public double NetPL { get; set; }
    public int Amount { get; set; }
}
