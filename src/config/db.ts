import mongoose from "mongoose";
import dotenv from 'dotenv';
dotenv.config();

/**
 * @async
 * @function dbconection
 * @description Establece la conexión con la base de datos MongoDB utilizando la URI proporcionada en las variables de entorno.
 *              Registra en consola el éxito de la conexión y el nombre de la base de datos.
 * @returns {Promise<void>} Una promesa que se resuelve una vez que la conexión a la base de datos ha sido establecida.
 */
export async function dbconection(){
 let db = await mongoose.connect(process.env.MongoDb_Conection)
    console.log('conectado a la base de datos', db.connection.db.databaseName)
}