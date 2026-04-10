import { getLogger } from "../logger";

import movementsModel from "../models/movements";
import socketmarket from "../../lib/binance/sockets";
import { Server, Socket } from 'socket.io';


export interface DashboardFilters {
    strategy?: string | null;
    broker?: string | null;
    epic?: string | null;
    market?: string | null;
    type?: string | null;
    open?: boolean | null;
    dateFrom?: Date | string | null;
    dateTo?: Date | string | null;
    minGanancia?: number | null;
    maxGanancia?: number | null;
}


/**
 * Retrieves a paginated list of movements, optionally filtered by strategy.
 * @param page - The page number to retrieve.
 * @param limit - The number of movements per page.
 * @param strategy - The strategy to filter by.
 * @returns An object containing the movements, total pages, and current page.
 */
export async function dashboard(page: number = 1, limit: number = 5, filters: DashboardFilters = {}) {
    const skip = (page - 1) * limit;

    const query: any = {};

    // String exact matches
    if (filters.strategy && filters.strategy !== '') query.strategy = filters.strategy;
    if (filters.broker && filters.broker !== '') query.broker = filters.broker;
    if (filters.epic && filters.epic !== '') query.epic = filters.epic;
    if (filters.market && filters.market !== '') query.market = filters.market;
    if (filters.type && filters.type !== '') query.type = filters.type;

    // Boolean open
    if (filters.open !== undefined && filters.open !== null) query.open = filters.open;

    // Date range on myRegionalDate
    if (filters.dateFrom || filters.dateTo) {
        query.myRegionalDate = {};
        if (filters.dateFrom) {
            const d = new Date(filters.dateFrom as any);
            d.setHours(0, 0, 0, 0);
            query.myRegionalDate.$gte = d;
        }
        if (filters.dateTo) {
            const d2 = new Date(filters.dateTo as any);
            d2.setHours(23, 59, 59, 999);
            query.myRegionalDate.$lte = d2;
        }
    }

    // Ganancia range
    if ((filters.minGanancia !== undefined && filters.minGanancia !== null) || (filters.maxGanancia !== undefined && filters.maxGanancia !== null)) {
        query.ganancia = {};
        if (filters.minGanancia !== undefined && filters.minGanancia !== null) query.ganancia.$gte = Number(filters.minGanancia);
        if (filters.maxGanancia !== undefined && filters.maxGanancia !== null) query.ganancia.$lte = Number(filters.maxGanancia);
    }

    const movements = await movementsModel.find(query).skip(skip).limit(limit).sort({ myRegionalDate: -1 });
    const totalMovements = await movementsModel.countDocuments(query);
    const totalPages = Math.ceil(totalMovements / limit);

    return {
        movements,
        totalPages,
        currentPage: page
    };
}

export async function dashboard2(page: number = 1, limit: number = 5, filters: DashboardFilters = {}) {
    const skip = (page - 1) * limit;

    const query: any = {};

    // String exact matches
    if (filters.strategy && filters.strategy !== '') query.strategy = filters.strategy;
    if (filters.broker && filters.broker !== '') query.broker = filters.broker;
    if (filters.epic && filters.epic !== '') query.epic = filters.epic;
    if (filters.market && filters.market !== '') query.market = filters.market;
    if (filters.type && filters.type !== '') query.type = filters.type;

    // Boolean open
    if (filters.open !== undefined && filters.open !== null) query.open = filters.open;

    // Date range on myRegionalDate
    if (filters.dateFrom || filters.dateTo) {
        query.myRegionalDate = {};
        if (filters.dateFrom) {
            const d = new Date(filters.dateFrom as any);
            d.setHours(0, 0, 0, 0);
            query.myRegionalDate.$gte = d;
        }
        if (filters.dateTo) {
            const d2 = new Date(filters.dateTo as any);
            d2.setHours(23, 59, 59, 999);
            query.myRegionalDate.$lte = d2;
        }
    }

    // Ganancia range
    if ((filters.minGanancia !== undefined && filters.minGanancia !== null) || (filters.maxGanancia !== undefined && filters.maxGanancia !== null)) {
        query.ganancia = {};
        if (filters.minGanancia !== undefined && filters.minGanancia !== null) query.ganancia.$gte = Number(filters.minGanancia);
        if (filters.maxGanancia !== undefined && filters.maxGanancia !== null) query.ganancia.$lte = Number(filters.maxGanancia);
    }

    const movements = await movementsModel.find(query).skip(skip).limit(limit).sort({ myRegionalDate: -1 });
    const totalMovements = await movementsModel.countDocuments(query);
    const totalPages = Math.ceil(totalMovements / limit);

    return {
        movements,
        totalPages,
        currentPage: page
    };
}

/**
 * Registers Socket.IO handlers for dashboard requests.
 * Listens for `dashboard:request` events and replies with `dashboard:response`.
 * Payload: { requestId?: string, page?: number, limit?: number, filters?: DashboardFilters }
 */
export function registerDashboardSocket(socket: Socket) {
    socket.on('dashboard:request', async (payload: any) => {
        try {
            const page = payload && payload.page ? Number(payload.page) : 1;
            const limit = payload && payload.limit ? Math.min(Number(payload.limit), 100) : 5;
            const filters = payload && payload.filters ? payload.filters : {};

            const result = await dashboard2(page, limit, filters as DashboardFilters);

            socket.emit('dashboard:response', {
                success: true,
                requestId: payload && payload.requestId ? payload.requestId : undefined,
                data: result
            });
        } catch (err) {
            const lg = getLogger('dashboard-socket');
            lg.error({ err }, 'Error handling dashboard:request');
            socket.emit('dashboard:response', {
                success: false,
                requestId: payload && payload.requestId ? payload.requestId : undefined,
                error: 'Internal server error'
            });
        }
    });

    // subscribe / unsubscribe handlers
    socket.on('dashboard:subscribe', async (payload: any) => {
        try {
            const page = payload && payload.page ? Number(payload.page) : 1;
            const limit = payload && payload.limit ? Math.min(Number(payload.limit), 100) : 5;
            const filters = payload && payload.filters ? payload.filters : {};

            subscribeDashboardSocket(socket, { page, limit, filters, requestId: payload && payload.requestId });
        } catch (err) {
            const lg = getLogger('dashboard-socket');
            lg.error({ err }, 'Error handling dashboard:subscribe');
            socket.emit('dashboard:subscribed', { success: false, error: 'Internal server error' });
        }
    });

    socket.on('dashboard:unsubscribe', () => {
        unsubscribeDashboardSocket(socket);
    });
}

/**
 * Register a dedicated namespace `/dashboard` and attach handlers there.
 * This keeps dashboard socket traffic separated from other socket handlers.
 */
export function registerDashboardNamespace(io: Server) {
    try {
        const nsp = io.of('/dashboard');
        nsp.on('connection', (socket: Socket) => {
            try {
                registerDashboardSocket(socket);
            } catch (err) {
                const lg = getLogger('dashboard-namespace');
                lg.error({ err }, 'Failed to register dashboard socket handlers for namespace connection');
            }
        });
    } catch (err) {
        const lg = getLogger('dashboard-namespace');
        lg.error({ err }, 'Failed to create /dashboard namespace');
    }
}


export async function csv(strategy: string) {

    let movements;
    if (strategy === '' || strategy === undefined || strategy === null) {
        movements = await movementsModel.find();
    }
    else {
        movements = await movementsModel.find({ strategy: strategy });
    }

    return movements;
}

// --- Dashboard subscription management ---

const dashboardSubscribers: Map<Socket, { page?: number; limit?: number; filters?: DashboardFilters; requestId?: any }> = new Map();

export function subscribeDashboardSocket(socket: Socket, opts: { page?: number; limit?: number; filters?: DashboardFilters; requestId?: any } = {}) {
    dashboardSubscribers.set(socket, opts);

    // cleanup on disconnect
    socket.once('disconnect', () => {
        dashboardSubscribers.delete(socket);
    });

    // send immediate snapshot
    (async () => {
        try {
            const page = opts.page || 1;
            const limit = opts.limit || 5;
            const filters = opts.filters || {};
            const data = await dashboard2(page, limit, filters as DashboardFilters);
            socket.emit('dashboard:subscribed', { success: true, requestId: opts.requestId, data });
        } catch (err) {
            const lg = getLogger('dashboard-socket');
            lg.error({ err }, 'Error sending initial dashboard snapshot to subscriber');
            socket.emit('dashboard:subscribed', { success: false, error: 'Internal server error' });
        }
    })();
}

export function unsubscribeDashboardSocket(socket: Socket) {
    if (dashboardSubscribers.has(socket)) {
        dashboardSubscribers.delete(socket);
        try {
            socket.emit('dashboard:unsubscribed', { success: true });
        } catch (_) { }
    }
}

/** Emit dashboard updates to all subscribed sockets. */
export async function emitDashboardUpdates() {
    if (dashboardSubscribers.size === 0) return;

    // iterate over a snapshot array to avoid requiring --downlevelIteration for Map iterators
    for (const [socket, opts] of Array.from(dashboardSubscribers.entries())) {
        try {
            const page = opts.page || 1;
            const limit = opts.limit || 5;
            const filters = opts.filters || {};
            const data = await dashboard2(page, limit, filters as DashboardFilters);
            socket.emit('dashboard:update', { success: true, requestId: opts.requestId, data });
        } catch (err) {
            const lg = getLogger('dashboard-socket');
            lg.error({ err }, 'Error emitting dashboard update to subscriber');
            try {
                socket.emit('dashboard:update', { success: false, error: 'Internal server error' });
            } catch (_) { }
        }
    }
}

/**
 * Calculates the total profit per strategy for a given number of days.
 * @param days - The number of days to look back.
 * @returns A promise that resolves to an array of objects, each containing the strategy and its total profit.
 */
export async function totalGananciaPorEstrategia(filter: string) {

    let days = 1;

    filter === 'diario' ? days = 1 : null
    filter === 'semanal' ? days = 7 : null
    filter === 'mensual' ? days = 30 : null


    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - days);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    if (filter === 'todo') {
        const result = await movementsModel.aggregate([
            { $group: { _id: "$strategy", totalGanancia: { $sum: "$ganancia" } } }
        ]);
        return result;
    }
    else {
        const result = await movementsModel.aggregate([
            { $match: { myRegionalDate: { $gte: sevenDaysAgo } } },
            { $group: { _id: "$strategy", totalGanancia: { $sum: "$ganancia" } } }
        ]);
        return result;
    }
}

/**
 * Calculates the total profit per broker for a given number of days.
 * @param days - The number of days to look back.
 * @returns A promise that resolves to an array of objects, each containing the broker and its total profit.
 */
export async function totalGananciaPorBroker(filter: string) {

    let days = 1;

    filter === 'diario' ? days = 1 : null
    filter === 'semanal' ? days = 7 : null
    filter === 'mensual' ? days = 30 : null

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - days);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    if (filter === 'todo') {
        const result = await movementsModel.aggregate([
            { $group: { _id: "$broker", totalGanancia: { $sum: "$ganancia" } } }
        ])

        return result;
    }
    else {
        const result = await movementsModel.aggregate([
            { $match: { myRegionalDate: { $gte: sevenDaysAgo } } },
            { $group: { _id: "$broker", totalGanancia: { $sum: "$ganancia" } } }
        ])

        return result;
    }
}

// --- Real-time total ganancia emitter (debounced polling + change detection) ---

let totalEmitterInterval: NodeJS.Timeout | null = null;
let lastTotalGanancia: number | null = null;

/**
 * Compute total ganancia using aggregation
 */
export async function computeTotalGanancia(): Promise<number> {
    const res = await movementsModel.aggregate([
        { $group: { _id: null, total: { $sum: "$ganancia" } } }
    ]);
    const total = res && res[0] && res[0].total ? Number(res[0].total) : 0;
    return total;
}

/**
 * Start emitting total ganancia periodically to Socket.IO clients.
 * Emits `dashboard:totalGanancia` only when value changes to avoid overload.
 * @param io Socket.IO server instance
 * @param intervalMs polling interval in ms (default 5000)
 */
export function startTotalGananciaEmitter(io: Server, intervalMs: number = 5000) {
    if (totalEmitterInterval) return; // already running

    const run = async () => {
        try {
            const total = await computeTotalGanancia();
            if (lastTotalGanancia === null || total !== lastTotalGanancia) {
                lastTotalGanancia = total;
                io.emit('dashboard:totalGanancia', { total });
            }
        } catch (err) {
            // log but don't crash
            const lg = getLogger('dashboard-total-emitter');
            lg.error({ err }, 'Error computing total ganancia');
        }
    };

    // run immediately then schedule
    run();
    totalEmitterInterval = setInterval(run, intervalMs);
}

export function stopTotalGananciaEmitter() {
    if (totalEmitterInterval) {
        clearInterval(totalEmitterInterval);
        totalEmitterInterval = null;
    }
}

/**
 * Force recompute and emit if changed. Can be called after inserts/updates.
 */
export async function notifyTotalGananciaUpdate(io?: Server) {
    try {
        const total = await computeTotalGanancia();
        if (lastTotalGanancia === null || total !== lastTotalGanancia) {
            lastTotalGanancia = total;
            if (io) io.emit('dashboard:totalGanancia', { total });
            // also emit paginated dashboard updates to subscribers
            try {
                await emitDashboardUpdates();
            } catch (e) {
                const lg = getLogger('dashboard-total-emitter');
                lg.error({ err: e }, 'Error emitting dashboard updates after totalGanancia change');
            }
        }
    } catch (err) {
        const lg = getLogger('dashboard-total-emitter');
        lg.error({ err }, 'Error notifying total ganancia update');
    }
}

/**
 * Groups profit by strategy, either monthly or daily, for a given number of days.
 * @param days - The number of days to look back.
 * @param periodo - The period to group by, either 'mensual' or 'diario'.
 * @returns A promise that resolves to an array of formatted data entries.
 */
export async function gananciaAgrupadaPorEstrategia(filter: 'diario' | 'semanal' | 'mensual' | 'todo' = 'mensual') {

    let days = 0;
    let periodo: 'mensual' | 'diario' | 'semanal' = 'diario';

    switch (filter) {
        case 'diario':
            days = 15;
            periodo = 'diario';
            break;
        case 'semanal':
            days = 90; // 4 semanas
            periodo = 'semanal';
            break;
        case 'mensual':
            days = 0;
            periodo = 'mensual';
            break;
        case 'todo':
            periodo = 'mensual';
            break;
    }

    const dateLimit = new Date();
    if (days > 0) {
        dateLimit.setDate(dateLimit.getDate() - days);
        dateLimit.setHours(0, 0, 0, 0);
    }

    let groupById: any;
    let sortById: any;
    let secondGroupId: any;

    if (periodo === 'mensual') {
        groupById = {
            year: { $year: "$myRegionalDate" },
            month: { $month: "$myRegionalDate" }
        };
        secondGroupId = {
            year: "$_id.year",
            month: "$_id.month"
        };
        sortById = {
            "_id.year": 1,
            "_id.month": 1
        };
    } else if (periodo === 'semanal') {
        groupById = {
            year: { $isoWeekYear: "$myRegionalDate" },
            week: { $isoWeek: "$myRegionalDate" }
        };
        secondGroupId = {
            year: "$_id.year",
            week: "$_id.week"
        };
        sortById = {
            "_id.year": 1,
            "_id.week": 1
        };
    } else { // diario
        groupById = {
            year: { $year: "$myRegionalDate" },
            month: { $month: "$myRegionalDate" },
            day: { $dayOfMonth: "$myRegionalDate" }
        };
        secondGroupId = {
            year: "$_id.year",
            month: "$_id.month",
            day: "$_id.day"
        };
        sortById = {
            "_id.year": 1,
            "_id.month": 1,
            "_id.day": 1
        };
    }

    const aggregationPipeline: any[] = [];

    if (days > 0) {
        aggregationPipeline.push({
            $match: {
                myRegionalDate: { $gte: dateLimit }
            }
        });
    }

    aggregationPipeline.push(
        {
            $group: {
                _id: {
                    ...groupById,
                    strategy: "$strategy"
                },
                totalGanancia: { $sum: "$ganancia" }
            }
        },
        {
            $group: {
                _id: secondGroupId,
                strategies: {
                    $push: {
                        strategy: "$_id.strategy",
                        totalGanancia: "$totalGanancia"
                    }
                }
            }
        },
        {
            $sort: sortById
        }
    );

    const aggregationResult = await movementsModel.aggregate(aggregationPipeline);

    // Format the data to match the desired JSON structure
    const formattedResult = aggregationResult.map(item => {

        let formattedDate: string;

        if (periodo === 'mensual') {
            const date = new Date(item._id.year, item._id.month - 1, 1);
            formattedDate = date.toLocaleString('en-US', { month: 'short' }) + ' ' + date.getFullYear().toString().slice(-2);
        } else if (periodo === 'semanal') {
            formattedDate = `Semana ${item._id.week} '${item._id.year.toString().slice(-2)}`;
        } else { // diario
            const date = new Date(item._id.year, item._id.month - 1, item._id.day);
            formattedDate = date.toLocaleString('en-US', { month: 'short', day: '2-digit' }) + ' ' + date.getFullYear().toString().slice(-2);
        }

        const dataEntry: { [key: string]: any } = {
            date: formattedDate,
            estrategias: []
        };

        item.strategies.forEach((s: any) => {
            let estrategiaFormateada = {
                estrategia: s.strategy.toUpperCase(),
                ganancia: s.totalGanancia.toFixed(2)
            }
            dataEntry.estrategias.push(estrategiaFormateada);
        });

        return dataEntry;
    });




    return await completarEstrategias(formattedResult)
}

async function completarEstrategias(jsonData) {
    const m = await movementsModel.distinct('strategy')
    return jsonData.map(semana => {
        const estrategiasEnSemana = semana.estrategias.map(e => e.estrategia);
        const estrategiasFaltantes = m.filter(
            estrategia => !estrategiasEnSemana.includes(estrategia.toUpperCase())
        );

        // Agregar las estrategias faltantes con ganancia 0
        estrategiasFaltantes.forEach(estrategia => {
            semana.estrategias.push({
                estrategia: estrategia.toUpperCase(),
                ganancia: "0.00"
            });
        });

        return semana;
    });
}
