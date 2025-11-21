import amqp from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL;

let channel: amqp.Channel

export async function connectRabbitMQ() {
    try {
        const c = await amqp.connect(RABBITMQ_URL);
        const ch = await c.createChannel();
        channel = ch;
        console.log('✅ RabbitMQ connected');
    } catch (error) {
        console.error('❌ RabbitMQ connection error:', error);
    }
}

export function getRabbitMQChannel(): amqp.Channel | null {
    return channel;
}
