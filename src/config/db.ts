import mongoose from "mongoose";
import dotenv from 'dotenv';
import { getLogger } from "./logger";
const log = getLogger('db');
dotenv.config();


/**
 * @async
 * @function dbconection
 * @description Establece la conexión con la base de datos MongoDB utilizando la URI proporcionada en las variables de entorno.
 *              Registra en consola el éxito de la conexión y el nombre de la base de datos.
 * @returns {Promise<void>} Una promesa que se resuelve una vez que la conexión a la base de datos ha sido establecida.
 */
export async function dbconection() {
    try {
        if (!process.env.MongoDb_Conection) {
            throw new Error("La variable MongoDb_Conection está VACÍA en el sistema.");
        }
        await mongoose.connect(process.env.MongoDb_Conection, {
            maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 20,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            family: 4,
        });
        log.info('Conexión a la base de datos establecida correctamente.');
    } catch (error) {
        log.error('Error al conectar a la base de datos:', error);
        // Silenciosamente esperar antes de regresar; evitamos logs en este módulo.
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}