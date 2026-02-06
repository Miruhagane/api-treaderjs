import { getRabbitMQChannel } from '../config/rabbitmq';
import { _executePosition, _capitalbuyandsell } from '../capital';
import { Server } from 'socket.io';

const epicLocks = new Set<string>();

async function processWithEpicLock(epic: string, handler: () => Promise<void>) {
    if (epicLocks.has(epic)) {
        // EPIC en uso → requeue
        throw new Error("EPIC_LOCKED");
    }

    epicLocks.add(epic);

    try {
        await handler();
    } finally {
        epicLocks.delete(epic);
    }
}

function delay(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
}

function getDelayWithJitter(baseMs: number) {
    const jitter = (Math.random() * 0.2) - 0.1; // ±10%
    return Math.max(0, Math.round(baseMs * (1 + jitter)));
}

export const GLOBAL_DELAY_MS = 300; // ajusta según tus pruebas

export async function startCapitalWorker(io: Server) {
    // logging removed
    const channel = await getRabbitMQChannel();
    if (!channel) {
        // logging removed
        return;
    }

    const queue = 'capital_tasks';
    await channel.assertQueue(queue, { durable: true });
    channel.prefetch(1); // MUY IMPORTANTE: procesa 1 mensaje a la vez

    // logging removed

    channel.consume(queue, async (msg) => {
        if (!msg) return;

        const raw = msg.content.toString();
        const task = JSON.parse(raw);
        const { epic } = task.payload;

        // logging removed

        try {
            await processWithEpicLock(epic, async () => {
                // Delay antes de ejecutar
                const ms = getDelayWithJitter(GLOBAL_DELAY_MS);
                await delay(ms);

                // Ejecutar tipo de orden
                switch (task.type) {
                    case 'position':
                        await _executePosition(
                            task.payload.epic,
                            task.payload.size,
                            task.payload.type,
                            task.payload.strategy,
                            io
                        );
                        break;

                    case 'capitalbuyandsell':
                        await _capitalbuyandsell(
                            task.payload.epic,
                            task.payload.size,
                            task.payload.type,
                            task.payload.strategy,
                            io
                        );
                        break;
                }
            });

            // OK
            channel.ack(msg);

        } catch (err: any) {

            // Si el EPIC estaba bloqueado → reenviar después
                if (err.message === "EPIC_LOCKED") {
                // logging removed
                channel.nack(msg, false, true); // requeue = true
                return;
            }

            // Otros errores → log + requeue (o descartar según prefieras)
            // logging removed
            channel.nack(msg, false, true);
        }
    });
}
