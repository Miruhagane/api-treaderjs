import movementsModel from "../models/movements";


export async function dashboard(page: number = 1, limit: number = 5) {
    const skip = (page - 1) * limit;
    const movements = await movementsModel.find().skip(skip).limit(limit).sort({ myRegionalDate: -1 });
    const totalMovements = await movementsModel.countDocuments();
    const totalPages = Math.ceil(totalMovements / limit);

    return {
        movements,
        totalPages,
        currentPage: page
    };
}

