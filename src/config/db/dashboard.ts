import movementsModel from "../models/movements";


export async function dashboard(page: number = 1, limit: number = 5, strategy?: string) {
    const skip = (page - 1) * limit;
    const movements = await movementsModel.find({ strategy: strategy }).skip(skip).limit(limit).sort({ myRegionalDate: -1 });
    const totalMovements = await movementsModel.countDocuments();
    const totalPages = Math.ceil(totalMovements / limit);

    return {
        movements,
        totalPages,
        currentPage: page
    };
}

export async function totalGananciaPorEstrategia(days: number) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - days);
    sevenDaysAgo.setHours(0, 0, 0, 0);


    const result = await movementsModel.aggregate([
        {

            $match: {
                myRegionalDate: { $gte: sevenDaysAgo }
            }
        },
        {
            $group: {
                _id: "$strategy",
                totalGanancia: { $sum: "$ganancia" }
            }
        }
    ]);
    return result;
}

export async function totalGananciaPorBroker(days: number) {

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - days);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const result = await movementsModel.aggregate([
        {

            $match: {
                myRegionalDate: { $gte: sevenDaysAgo }
            }
        },
        {
            $group: {
                _id: "$broker",
                totalGanancia: { $sum: "$ganancia" }
            }
        }
    ])

    return result;

}