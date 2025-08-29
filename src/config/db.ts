import mongoose from "mongoose";
import dotenv from 'dotenv';
dotenv.config();

export async function dbconection(){
 let db = await mongoose.connect(process.env.MongoDb_Conection)
    console.log('conectado a la base de datos', db.connection.db.databaseName)
}