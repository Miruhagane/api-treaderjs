import movementsModel from "../models/movements";


export async function dashboard(page: number = 1, limit: number = 5, strategy?: string) {
    const skip = (page - 1) * limit;

    let movements;
    if (strategy === '' || strategy === undefined) {
        movements = await movementsModel.find().skip(skip).limit(limit).sort({ myRegionalDate: -1 });
    }
    else {
        movements = await movementsModel.find({ strategy: strategy }).skip(skip).limit(limit).sort({ myRegionalDate: -1 });
    }
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

export async function gananciaAgrupadaPorEstrategia(days: number, periodo: 'mensual' | 'diario' = 'mensual') {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - days);
    dateLimit.setHours(0, 0, 0, 0);

    let groupById: any;
    let sortById: any;
    if (periodo === 'mensual') {
        groupById = {
            year: { $year: "$myRegionalDate" },
            month: { $month: "$myRegionalDate" }
        };
        sortById = {
            "_id.year": 1,
            "_id.month": 1
        };
    } else { // diario
        groupById = {
            year: { $year: "$myRegionalDate" },
            month: { $month: "$myRegionalDate" },
            day: { $dayOfMonth: "$myRegionalDate" }
        };
        sortById = {
            "_id.year": 1,
            "_id.month": 1,
            "_id.day": 1
        };
    }

    const aggregationResult = await movementsModel.aggregate([
        {
            $match: {
                myRegionalDate: { $gte: dateLimit }
            }
        },
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
                _id: {
                    year: "$_id.year",
                    month: "$_id.month",
                    ...(periodo === 'diario' && { day: "$_id.day" })
                },
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
    ]);

    // Format the data to match the desired JSON structure
    const formattedResult = aggregationResult.map(item => {

        const year = item._id.year;
        const month = item._id.month - 1;
        const day = periodo === 'diario' ? item._id.day : 1;
        const date = new Date(year, month, day);


        let formattedDate: string;
        if (periodo === 'mensual') {
            formattedDate = date.toLocaleString('en-US', { month: 'short' }) + ' ' + date.getFullYear().toString().slice(-2);
        } else {
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

    return formattedResult;
}
