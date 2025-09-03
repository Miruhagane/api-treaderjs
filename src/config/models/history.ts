import { getModelForClass, prop, Ref } from "@typegoose/typegoose";
import { movements } from "./movements";

class History {

    @prop({ required: true })
    idRefBroker: string;

    @prop()
    event: string;

    @prop({ default: () => new Date() })
    timestamp: Date;

    @prop({ ref: () => movements })
    movementRef: Ref<movements>;
}

const HistoryModel = getModelForClass(History);
export default HistoryModel;