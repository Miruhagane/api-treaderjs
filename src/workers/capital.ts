import { getRabbitMQChannel } from '../config/rabbitmq';
import { _executePosition, _capitalbuyandsell } from '../capital';
import { Server } from 'socket.io';

export async function startCapitalWorker(io: Server) {
    console.log('Starting capital worker...');
    const channel = await getRabbitMQChannel();
    if (!channel) {
        console.error('RabbitMQ channel is not available for worker');
        return;
    }

    console.log(channel)
    const queue = 'capital_tasks';
    await channel.assertQueue(queue, { durable: true });

    console.log(`[*] Capital worker waiting for messages in ${queue}.`);

    channel.consume(queue, async (msg) => {
        if (msg !== null) {
            console.log('Message received by capital worker:', msg.content.toString());
            const task = JSON.parse(msg.content.toString());
            console.log(`[x] Received ${task.description}`);
            try {
                switch (task.type) {
                    case 'position':
                        await _executePosition(task.payload.epic, task.payload.size, task.payload.type, task.payload.strategy, io);
                        break;
                    case 'capitalbuyandsell':
                        await _capitalbuyandsell(task.payload.epic, task.payload.size, task.payload.type, task.payload.strategy, io);
                        break;
                }
                channel.ack(msg);
            } catch (error) {
                console.error(`Error processing task: ${task.description}`, error);
                channel.nack(msg);
            }
        }
    });
}
