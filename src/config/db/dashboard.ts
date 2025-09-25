import movementsModel from "../models/movements";


/**
 * Retrieves a paginated list of movements, optionally filtered by strategy.
 * @param page - The page number to retrieve.
 * @param limit - The number of movements per page.
 * @param strategy - The strategy to filter by.
 * @returns An object containing the movements, total pages, and current page.
 */
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

/**
 * Calculates the total profit per strategy for a given number of days.
 * @param days - The number of days to look back.
 * @returns A promise that resolves to an array of objects, each containing the strategy and its total profit.
 */
export async function totalGananciaPorEstrategia(days: number) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 1);
    sevenDaysAgo.setHours(0, 0, 0, 0);


    const result = await movementsModel.aggregate([
        // {

        //     $match: {
        //         myRegionalDate: { $gte: sevenDaysAgo }
        //     }
        // },
        {
            $group: {
                _id: "$strategy",
                totalGanancia: { $sum: "$ganancia" }
            }
        }
    ]);
    return result;
}

/**
 * Calculates the total profit per broker for a given number of days.
 * @param days - The number of days to look back.
 * @returns A promise that resolves to an array of objects, each containing the broker and its total profit.
 */
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

/**
 * Groups profit by strategy, either monthly or daily, for a given number of days.
 * @param days - The number of days to look back.
 * @param periodo - The period to group by, either 'mensual' or 'diario'.
 * @returns A promise that resolves to an array of formatted data entries.
 */
export async function gananciaAgrupadaPorEstrategia(days: number, periodo: 'mensual' | 'diario' = 'mensual') {

    let dias = 1
    dias = periodo === "mensual" ? 30 : days;

    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - dias);
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

    console.log(aggregationResult)

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