import amqp from 'amqplib';
import type { Connection, Channel } from 'amqplib';

let connection: Connection | null = null;
let channel: Channel | null = null;

export async function connectRabbitMQ() {
    try {
        connection = await amqp.connect(process.env.RABBITMQ_URL!);
        channel = await connection.createChannel();

        console.log("RabbitMQ connected");
    } catch (err) {
        console.error("RabbitMQ error:", err);
    }
}

export function getRabbitMQChannel(): Channel | null {
    return channel;
}
