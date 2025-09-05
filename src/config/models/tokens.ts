import { getModelForClass, prop } from "@typegoose/typegoose";

export class Token {
    @prop({ required: true })
    public CST: string;

    @prop({ required: true })
    public XSECURITYTOKEN: string;

    @prop({ required: true })
    public timestamp: number;

    @prop({ required: true, unique: true })
    public broker: string;
}

const TokenModel = getModelForClass(Token);
export default TokenModel;
