import { getModelForClass, prop } from "@typegoose/typegoose";

export class movements {

    @prop({ required: true })
    idRefBroker: string

    @prop({ required: true })
    strategy: string

    @prop({ required: true })
    open: boolean

    @prop({ required: true })
    broker: string

    @prop({ required: true })
    date: Date

    @prop({ required: true })
    myRegionalDate: Date
}

const movementsModel = getModelForClass(movements);
export default movementsModel;