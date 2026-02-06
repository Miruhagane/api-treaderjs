// config/rabbitmq.ts
import amqp from 'amqplib';
import type { Connection, Channel } from 'amqplib';

let connection: Connection | null = null;
let channel: Channel | null = null;

export async function connectRabbitMQ() {
    try {
        connection = await amqp.connect(process.env.RABBITMQ_URL!);
        channel = await connection.createChannel();

        // logging removed

        // =============================
        //   CONFIGURAR DELAY EXCHANGE
        // =============================
        await channel.assertExchange("delay-exchange", "x-delayed-message", {
            durable: true,
            arguments: { "x-delayed-type": "direct" }
        });

        // Cola donde llegan los mensajes YA retrasados
        await channel.assertQueue("capital_tasks", { durable: true });

        // Enlazar exchange -> route -> cola
        await channel.bindQueue("capital_tasks", "delay-exchange", "capital_route");

        // logging removed
    } catch (err) {
        // logging removed
    }
}

export function getRabbitMQChannel(): Channel | null {
    return channel;
}
