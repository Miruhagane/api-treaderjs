import { getModelForClass, prop } from "@typegoose/typegoose";

/**
 * Represents a movement in the system, likely a trade or transaction.
 */
export class movements {

    /**
     * The reference ID of the broker.
     */
    @prop({ required: true })
    idRefBroker: string

    /**
     * The strategy associated with this movement.
     */
    @prop({ required: true })
    strategy: string

    @prop({ required: false })
    epic: string

    @prop({ required: false })
    market: string

    /**
     * Indicates if the movement is open.
     */
    @prop({ required: true })
    open: boolean

    @prop({ required: true })
    type: string


    @prop({ required: true })
    size: number

    /**
     * The buying price of the movement.
     */
    @prop({ required: true })
    buyPrice: number

    /**
     * The selling price of the movement.
     */
    @prop({ required: true })
    sellPrice: number

    /**
    * The margin of the movement.
    */
    @prop({ required: true })
    margen: number

    /**
     * The profit or loss from the movement.
     */
    @prop({ required: true })
    ganancia: number

    /**
     * The broker associated with this movement.
     */
    @prop({ required: true })
    broker: string

    /**
     * The date of the movement.
     */
    @prop({ required: true })
    date: Date

    /**
     * The regional date of the movement.
     */
    @prop({ required: true })
    myRegionalDate: Date
}

const movementsModel = getModelForClass(movements);
export default movementsModel;