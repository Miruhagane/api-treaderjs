import { getModelForClass, prop, Ref } from "@typegoose/typegoose";
import { movements } from "./movements";

/**
 * Represents the history of an event.
 */
class History {

    /**
     * The reference ID of the broker.
     */
    @prop({ required: true })
    idRefBroker: string;

    /**
     * The event that occurred.
     */
    @prop()
    event: string;

    /**
     * The timestamp of the event.
     */
    @prop({ default: () => new Date() })
    timestamp: Date;

    /**
     * A reference to the movement associated with this history entry.
     */
    @prop({ ref: () => movements })
    movementRef: Ref<movements>;
}

const HistoryModel = getModelForClass(History);
export default HistoryModel;