import EventEmitter from 'events';
import WebSocket from 'ws';
import { getLogger } from '../../config/logger';

const log = getLogger('binance-sockets');

type WSInfo = {
    ws: WebSocket;
    symbols: string[];
    reconnectMs: number;
    pingInterval?: NodeJS.Timeout;
    lastPong?: number;
};

const CHUNK_SIZE = 500; // adjust based on practical limits
const RESTART_DEBOUNCE = 300; // ms to batch subscribe/unsubscribe

class BinanceMarket extends EventEmitter {
    private wsMap = new Map<number, WSInfo>();
    private symbols = new Set<string>();
    private prices = new Map<string, number>();
    private closedByUser = false;
    private rebuildTimer?: NodeJS.Timeout;

    subscribe(sym: string) {
        const s = sym.toLowerCase();
        if (!this.symbols.has(s)) {
            this.symbols.add(s);
            this.scheduleRebuild();
        }
    }

    unsubscribe(sym: string) {
        const s = sym.toLowerCase();
        if (this.symbols.delete(s)) {
            this.prices.delete(sym.toUpperCase());
            this.scheduleRebuild();
        }
    }

    getPrice(sym: string) {
        return this.prices.get(sym.toUpperCase());
    }

    stop() {
        this.closedByUser = true;
        this.clearAllConnections();
    }

    private scheduleRebuild() {
        if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
        this.rebuildTimer = setTimeout(() => this.rebuildConnections(), RESTART_DEBOUNCE);
    }

    private rebuildConnections() {
        this.rebuildTimer = undefined;
        const symbolsArr = Array.from(this.symbols);
        // create chunks
        const chunks: string[][] = [];
        for (let i = 0; i < symbolsArr.length; i += CHUNK_SIZE) chunks.push(symbolsArr.slice(i, i + CHUNK_SIZE));

        // Close extra connections
        const needed = chunks.length;
        for (const key of Array.from(this.wsMap.keys())) {
            if (key >= needed) {
                log.debug({ key }, 'Closing extra ws chunk');
                this.closeConnection(key);
            }
        }

        // (re)create connections for chunks
        chunks.forEach((chunkSymbols, idx) => {
            const info = this.wsMap.get(idx);
            const same = info && arraysEqual(info.symbols, chunkSymbols);
            if (same && info.ws && info.ws.readyState === WebSocket.OPEN) return; // no change
            // else close existing and create new
            if (info) this.closeConnection(idx);
            this.connectChunk(idx, chunkSymbols);
        });
    }

    private connectChunk(idx: number, chunkSymbols: string[]) {
        if (chunkSymbols.length === 0) return;
        const streams = chunkSymbols.map(s => `${s}@trade`).join('/');
        const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
        log.info({ idx, count: chunkSymbols.length }, 'Connecting chunk');

        const ws = new WebSocket(url);
        const info: WSInfo = { ws, symbols: chunkSymbols, reconnectMs: 1000 };
        this.wsMap.set(idx, info);

        ws.on('open', () => {
            log.info({ idx }, 'ws open');
            info.lastPong = Date.now();
            // start ping
            info.pingInterval = setInterval(() => {
                try {
                    ws.ping();
                    // check pong
                    if (info.lastPong && Date.now() - info.lastPong! > 60000) {
                        log.warn({ idx }, 'No pong recent, terminating ws');
                        ws.terminate();
                    }
                } catch (e) {
                    log.error({ err: e }, 'Ping error');
                }
            }, 20000);
        });

        ws.on('pong', () => {
            info.lastPong = Date.now();
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                const payload = msg.data || msg; // combined stream wraps into { stream, data }
                if (payload && payload.s && payload.p) {
                    const symbol = payload.s.toUpperCase();
                    const price = Number(payload.p);
                    const prev = this.prices.get(symbol);
                    if (prev === undefined || prev !== price) {
                        this.prices.set(symbol, price);
                        this.emit('price', { symbol, price });
                        this.emit(`price:${symbol}`, price);
                    }
                }
            } catch (err) {
                log.error({ err }, 'ws message parse error');
                this.emit('error', err);
            }
        });

        ws.on('close', () => {
            log.info({ idx }, 'ws closed');
            this.wsMap.delete(idx);
            if (info.pingInterval) clearInterval(info.pingInterval);
            if (!this.closedByUser) {
                const delay = info.reconnectMs;
                info.reconnectMs = Math.min(info.reconnectMs * 1.5, 30000);
                setTimeout(() => {
                    // Guard again: stop() may have been called while the timer was pending
                    if (this.closedByUser) return;
                    const symbolsArr = Array.from(this.symbols);
                    const start = idx * CHUNK_SIZE;
                    const chunk = symbolsArr.slice(start, start + CHUNK_SIZE);
                    if (chunk.length) this.connectChunk(idx, chunk);
                }, delay);
            }
            this.emit('disconnected', { idx });
        });

        ws.on('error', (err) => {
            log.error({ err }, 'ws error');
            this.emit('error', err);
        });
    }

    private closeConnection(idx: number) {
        const info = this.wsMap.get(idx);
        if (!info) return;
        if (info.pingInterval) clearInterval(info.pingInterval);
        try {
            info.ws.removeAllListeners();
            info.ws.terminate();
        } catch (e) {
            log.warn({ err: e }, 'error terminating ws');
        }
        this.wsMap.delete(idx);
    }

    private clearAllConnections() {
        for (const key of Array.from(this.wsMap.keys())) this.closeConnection(key);
    }
}

function arraysEqual(a?: string[], b?: string[]) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

const socketmarket = new BinanceMarket();
export default socketmarket;