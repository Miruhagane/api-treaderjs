import { getModelForClass, prop } from "@typegoose/typegoose";

/**
 * Represents an authentication token with associated broker information.
 */
export class Token {
    /**
     * The CST (Client Security Token).
     */
    @prop({ required: true })
    public CST: string;

    /**
     * The X-SECURITY-TOKEN.
     */
    @prop({ required: true })
    public XSECURITYTOKEN: string;

    /**
     * The timestamp when the token was issued or last updated.
     */
    @prop({ required: true })
    public timestamp: number;

    /**
     * The broker associated with this token (must be unique).
     */
    @prop({ required: true, unique: true })
    public broker: string;
}

const TokenModel = getModelForClass(Token);
export default TokenModel;
