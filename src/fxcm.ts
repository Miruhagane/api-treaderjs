import { buyFxcm, closeFxcm } from "./lib/fxcm/fxcmMarket";
import { Server } from "socket.io";
import { getLogger } from "./config/logger";
import movementsModel from "./config/models/movements";
const logger = getLogger('fxcm');
const CONTINUOUS_EXECUTION_MODE = 'CONTINUOUS';


export async function fxcm(epic: string, size: number, type: string, strategy: string, io: Server) {

    if (type.toUpperCase() === 'BUY') {
        try {
            const response = await buyFxcm(epic, size, type);
            logger.info({ response }, 'FXCM order response');

            if (!response.success) {
                logger.error({ response }, 'FXCM order failed');
            }

            const movementsPartial = new movementsModel({
                idRefBroker: response.dealId,
                strategy: strategy,
                market: 'FUTURE',
                type: type,
                margen: 0,
                size: Number(size).toFixed(5) || 0,
                spotsizeSell: 0,
                epic,
                open: true,
                buyPrice: 0,
                sellPrice: 0,
                brokercommission: 0,
                brokercommissionSell: 0,
                ganancia: 0,
                broker: 'FXCM',
                date: new Date(),
                myRegionalDate: new Date().setHours(new Date().getHours() - 5)
            });

            await movementsPartial.save();

            io.emit('posicion_event', { type: type, strategy: strategy });
            return "posición de compra ejecutada y registros actualizados."
        }
        catch (error) {
            console.error('Error en la función fxcm:', error);
        }

    }

    if (type.toUpperCase() === 'SELL') {
        try {
            const ordenes = await movementsModel.find({ strategy: strategy, open: true, broker: 'FXCM', market: 'FUTURE' }).sort({ date: -1 });
            if (ordenes.length > 0) {
                const results: PromiseSettledResult<{ ordenId: any; success: boolean }>[] = await Promise.allSettled(ordenes.map(async (orden: any) => {
                    const response = await closeFxcm(orden.idRefBroker);
                    logger.info({ response, ordenId: orden._id, idRefBroker: orden.idRefBroker }, 'FXCM close order response');

                    const buyPrice = response?.openPrice || 0;
                    const sellPrice = response?.closePrice || 0;
                    const netPL = response?.netPL || 0;

                    const updateFields: Record<string, any> = {
                        open: false,
                        buyPrice,
                        sellPrice,
                        spotsizeSell: orden.size,
                        brokercommissionSell: 0,
                        ganancia: netPL,
                        closeRequestId: response?.requestId ?? null,
                        closedAt: new Date()
                    };
                    await movementsModel.updateOne({ _id: orden._id }, { $set: updateFields });
                    return { ordenId: orden._id, success: true };
                }));

                const failed: { r: PromiseRejectedResult; orden: any }[] = [];
                results.forEach((r, i) => {
                    if (r.status === 'rejected') {
                        failed.push({ r: r as PromiseRejectedResult, orden: ordenes[i] });
                    }
                });

                if (failed.length > 0) {
                    logger.error(
                        { failed: failed.map(f => ({ ordenId: f.orden._id, idRefBroker: f.orden.idRefBroker, reason: f.r.reason?.message })) },
                        'Algunas posiciones no pudieron cerrarse en FXCM'
                    );
                    for (const f of failed) {
                        io.emit('posicion_event', {
                            type: type,
                            strategy: strategy,
                            error: true,
                            ordenId: f.orden._id,
                            idRefBroker: f.orden.idRefBroker,
                            reason: f.r.reason?.message
                        });
                    }
                }
            }

            io.emit('posicion_event', { type: type, strategy: strategy });
            return "posicion cerrada y registros actualizados."
        }
        catch (error) {
            logger.error({ err: error, strategy, type }, 'Error en la función fxcm SELL');
            throw error;
        }
    }
}

export async function fxcmContinuous(epic: string, size: number, type: string, strategy: string, io: Server, market: string = 'FUTURE') {
    const normalizedType = String(type || '').toUpperCase();
    const normalizedEpic = String(epic || '').toUpperCase();
    const normalizedMarket = String(market || 'FUTURE').toUpperCase();

    if (normalizedType !== 'BUY' && normalizedType !== 'SELL') {
        return 'Tipo de operación no soportado.';
    }

    if (!normalizedEpic) {
        return 'Epic es requerido.';
    }

    if (normalizedMarket !== 'FUTURE') {
        return 'FXCM continuous solo soporta mercado FUTURE.';
    }

    const parsedSize = Number(size);
    if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
        return 'La cantidad para FXCM continuous debe ser mayor a 0.';
    }

    const continuousFilter = {
        broker: 'FXCM',
        epic: normalizedEpic,
        strategy,
        market: normalizedMarket,
        open: true,
        executionMode: CONTINUOUS_EXECUTION_MODE,
    };

    const continuousOrders = await movementsModel.find(continuousFilter).sort({ date: -1 });
    const currentOpenType = continuousOrders.length > 0 ? String(continuousOrders[0].type || '').toUpperCase() : null;
    const isOpenRequest = !currentOpenType || currentOpenType === normalizedType;

    if (isOpenRequest) {
        const response = await buyFxcm(normalizedEpic, parsedSize, normalizedType);
        logger.info({ response, normalizedEpic, parsedSize, normalizedType, strategy }, 'FXCM continuous open response');

        const dealId = String(response?.dealId ?? response?.orderId ?? '').trim();
        if (!dealId) {
            throw new Error('FXCM continuous open: no dealId/orderId returned');
        }

        const movement = new movementsModel({
            idRefBroker: dealId,
            strategy,
            market: normalizedMarket,
            executionMode: CONTINUOUS_EXECUTION_MODE,
            type: normalizedType,
            margen: 0,
            size: Number(parsedSize).toFixed(5) || 0,
            spotsizeSell: 0,
            epic: normalizedEpic,
            open: true,
            buyPrice: 0,
            sellPrice: 0,
            brokercommission: 0,
            brokercommissionSell: 0,
            ganancia: 0,
            broker: 'FXCM',
            date: new Date(),
            myRegionalDate: new Date().setHours(new Date().getHours() - 5)
        });

        await movement.save();
        io.emit('posicion_event', { type: normalizedType, strategy, epic: normalizedEpic, market: normalizedMarket, executionMode: CONTINUOUS_EXECUTION_MODE });
        return `Posición continua FXCM ${normalizedType} ejecutada y registrada correctamente.`;
    }

    await Promise.all(continuousOrders.map(async (orden: any): Promise<void> => {
        const response = await closeFxcm(orden.idRefBroker);
        logger.info({ response, ordenId: orden._id, idRefBroker: orden.idRefBroker, normalizedEpic }, 'FXCM continuous close response');

        const buyPrice = response?.openPrice || 0;
        const sellPrice = response?.closePrice || 0;
        const netPL = response?.netPL || 0;

        const updateFields: Record<string, any> = {
            open: false,
            buyPrice,
            sellPrice,
            spotsizeSell: orden.size,
            brokercommissionSell: 0,
            ganancia: netPL,
            closeRequestId: response?.requestId ?? null,
            closedAt: new Date()
        };
        await movementsModel.updateOne({ _id: orden._id }, { $set: updateFields });
    }));

    io.emit('posicion_event', { type: normalizedType, strategy, epic: normalizedEpic, market: normalizedMarket, executionMode: CONTINUOUS_EXECUTION_MODE });
    return `Posiciones continuas FXCM ${currentOpenType} cerradas con ${normalizedType} correctamente.`;
}