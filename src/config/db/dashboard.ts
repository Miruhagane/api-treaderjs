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

export async function csv(strategy: string) {

    let movements;
    if (strategy === '' || strategy === undefined || strategy === null) {
        movements = await movementsModel.find();
    }
    else {
        movements = await movementsModel.find({ strategy: strategy });
    }

    return movements;
}

/**
 * Calculates the total profit per strategy for a given number of days.
 * @param days - The number of days to look back.
 * @returns A promise that resolves to an array of objects, each containing the strategy and its total profit.
 */
export async function totalGananciaPorEstrategia(filter: string) {

    let days = 1;

    filter === 'diario' ? days = 1 : null
    filter === 'semanal' ? days = 7 : null
    filter === 'mensual' ? days = 30 : null


    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - days);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    if (filter === 'todo') {
        const result = await movementsModel.aggregate([
            { $group: { _id: "$strategy", totalGanancia: { $sum: "$ganancia" } } }
        ]);
        return result;
    }
    else {
        const result = await movementsModel.aggregate([
            { $match: { myRegionalDate: { $gte: sevenDaysAgo } } },
            { $group: { _id: "$strategy", totalGanancia: { $sum: "$ganancia" } } }
        ]);
        return result;
    }
}

/**
 * Calculates the total profit per broker for a given number of days.
 * @param days - The number of days to look back.
 * @returns A promise that resolves to an array of objects, each containing the broker and its total profit.
 */
export async function totalGananciaPorBroker(filter: string) {

    let days = 1;

    filter === 'diario' ? days = 1 : null
    filter === 'semanal' ? days = 7 : null
    filter === 'mensual' ? days = 30 : null

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - days);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    if (filter === 'todo') {
        const result = await movementsModel.aggregate([
            { $group: { _id: "$broker", totalGanancia: { $sum: "$ganancia" } } }
        ])

        return result;
    }
    else {
        const result = await movementsModel.aggregate([
            { $match: { myRegionalDate: { $gte: sevenDaysAgo } } },
            { $group: { _id: "$broker", totalGanancia: { $sum: "$ganancia" } } }
        ])

        return result;
    }
}

/**
 * Groups profit by strategy, either monthly or daily, for a given number of days.
 * @param days - The number of days to look back.
 * @param periodo - The period to group by, either 'mensual' or 'diario'.
 * @returns A promise that resolves to an array of formatted data entries.
 */
export async function gananciaAgrupadaPorEstrategia(filter: 'diario' | 'semanal' | 'mensual' | 'todo' = 'mensual') {

    let days = 0;
    let periodo: 'mensual' | 'diario' | 'semanal' = 'diario';

    switch (filter) {
        case 'diario':
            days = 15;
            periodo = 'diario';
            break;
        case 'semanal':
            days = 90; // 4 semanas
            periodo = 'semanal';
            break;
        case 'mensual':
            days = 0; 
            periodo = 'mensual';
            break;
        case 'todo':
            periodo = 'mensual';
            break;
    }

    const dateLimit = new Date();
    if (days > 0) {
        dateLimit.setDate(dateLimit.getDate() - days);
        dateLimit.setHours(0, 0, 0, 0);
    }

    let groupById: any;
    let sortById: any;
    let secondGroupId: any;

    if (periodo === 'mensual') {
        groupById = {
            year: { $year: "$myRegionalDate" },
            month: { $month: "$myRegionalDate" }
        };
        secondGroupId = {
            year: "$_id.year",
            month: "$_id.month"
        };
        sortById = {
            "_id.year": 1,
            "_id.month": 1
        };
    } else if (periodo === 'semanal') {
        groupById = {
            year: { $isoWeekYear: "$myRegionalDate" },
            week: { $isoWeek: "$myRegionalDate" }
        };
        secondGroupId = {
            year: "$_id.year",
            week: "$_id.week"
        };
        sortById = {
            "_id.year": 1,
            "_id.week": 1
        };
    } else { // diario
        groupById = {
            year: { $year: "$myRegionalDate" },
            month: { $month: "$myRegionalDate" },
            day: { $dayOfMonth: "$myRegionalDate" }
        };
        secondGroupId = {
            year: "$_id.year",
            month: "$_id.month",
            day: "$_id.day"
        };
        sortById = {
            "_id.year": 1,
            "_id.month": 1,
            "_id.day": 1
        };
    }

    const aggregationPipeline: any[] = [];

    if (days > 0) {
        aggregationPipeline.push({
            $match: {
                myRegionalDate: { $gte: dateLimit }
            }
        });
    }

    aggregationPipeline.push(
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
                _id: secondGroupId,
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
    );

    const aggregationResult = await movementsModel.aggregate(aggregationPipeline);

    // Format the data to match the desired JSON structure
    const formattedResult = aggregationResult.map(item => {

        let formattedDate: string;

        if (periodo === 'mensual') {
            const date = new Date(item._id.year, item._id.month - 1, 1);
            formattedDate = date.toLocaleString('en-US', { month: 'short' }) + ' ' + date.getFullYear().toString().slice(-2);
        } else if (periodo === 'semanal') {
            formattedDate = `Semana ${item._id.week} '${item._id.year.toString().slice(-2)}`;
        } else { // diario
            const date = new Date(item._id.year, item._id.month - 1, item._id.day);
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