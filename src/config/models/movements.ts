import { getModelForClass, prop } from "@typegoose/typegoose";

class movements {

    @prop()
    idRefBroker: string

    @prop()
    strategy: string

    @prop()
    open: boolean

    @prop()
    broker: string

    @prop()
    date: Date
}

const movementsModel = getModelForClass(movements);
export default movementsModel;