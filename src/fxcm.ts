import { buyFxcm, closeFxcm } from "./lib/fxcm/fxcmMarket";
import { Server } from "socket.io";
import { getLogger } from "./config/logger";
import movementsModel from "./config/models/movements";
const logger = getLogger('fxcm');


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
                for (const orden of ordenes) {
                    const response = await closeFxcm(orden.idRefBroker);
                    let data = response;
                    logger.info({ response }, 'FXCM close order response');

                    // Valores defensivos para evitar crashes
                    const buyPrice = data?.openPrice || 0;
                    const sellPrice = data?.closePrice || 0;
                    const netPL = data?.netPL || 0;

                    await movementsModel.updateOne(
                        { _id: orden._id },
                        {
                            $set: {
                                open: false,
                                buyPrice: buyPrice,
                                sellPrice: sellPrice,
                                spotsizeSell: orden.size,
                                brokercommissionSell: 0,
                                ganancia: netPL
                            }
                        }
                    );
                }
            }

            io.emit('posicion_event', { type: type, strategy: strategy });
            return "posicion cerrada y registros actualizados."
        }
        catch (error) {
            console.error('Error en la función fxcm:', error);
        }
    }
}