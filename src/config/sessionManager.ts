/**
 * @file Módulo para gestionar la sesión y los tokens de la API de Capital.com.
 * Se encarga de obtener, cachear y renovar los tokens de sesión para evitar
 * errores de "Too Many Requests" y mejorar el rendimiento.
 */

import axios from "axios";
import dotenv from 'dotenv';
import TokenModel from "./models/tokens";
dotenv.config();

const API_KEY = process.env.Capital_ApiKey;
const capitalPassword = process.env.Capital_Password;
const url_api = 'https://demo-api-capital.backend-capital.com/api/v1/';
const identifier = process.env.Capital_identifier;

const SESSION_DURATION = 10 * 60 * 1000; // 10 minutes in milliseconds

/**
 * @async
 * @function login
 * @description Inicia sesión en la API de Capital.com para obtener nuevos tokens de sesión.
 * @returns {Promise<{CST: string, XSECURITYTOKEN: string}>} Un objeto con los nuevos tokens de sesión.
 */
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

/**
 * @async
 * @function getSession
 * @description Obtiene los tokens de sesión para Capital.com.
 * Primero, busca un token válido y no expirado en la base de datos.
 * Si no lo encuentra, solicita nuevos tokens, los guarda en la base de datos y los devuelve.
 * @returns {Promise<any>} El documento del token de sesión, que incluye CST y XSECURITYTOKEN.
 */
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