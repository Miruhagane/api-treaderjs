import axios from "axios";
import dotenv from 'dotenv';
import TokenModel from "./models/tokens";
dotenv.config();

const API_KEY = process.env.Capital_ApiKey;
const capitalPassword = process.env.Capital_Password;
const url_api = 'https://demo-api-capital.backend-capital.com/api/v1/';
const identifier = process.env.Capital_identifier;

const SESSION_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

async function login() {
    const headers = {
        'X-CAP-API-KEY': API_KEY,
        'Content-Type': 'application/json',
    };

    const body = {
        identifier: identifier,
        password: capitalPassword,
        encryptedPassword: false
    };

    const response = await axios.post(
        `${url_api}session`,
        body,
        { headers }
    );

    return {
        "CST": response.headers.cst,
        "XSECURITYTOKEN": response.headers['x-security-token'],
    };
}

export async function getSession() {
    const existingToken = await TokenModel.findOne({ broker: 'capital' });

    if (existingToken && (Date.now() - existingToken.timestamp < SESSION_DURATION)) {
        return existingToken;
    }

    const newTokens = await login();
    const updatedToken = await TokenModel.findOneAndUpdate(
        { broker: 'capital' },
        { ...newTokens, timestamp: Date.now() },
        { new: true, upsert: true }
    );

    return updatedToken;
}
