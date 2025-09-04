import { Resend } from "resend";
import dotenv from 'dotenv';
dotenv.config();


const resend = new Resend(process.env.RESEND_API_KEY);


export const errorSendEmail = async(asunto: string, mensaje: string) => {
    resend.emails.send({
  from: 'onboarding@resend.dev',
  to: 'ricardokurosaki23@gmail.com',
  subject: asunto,
  html: '<p><strong>Hubo un error en el servidor</strong>! </p>' + '<p>' + mensaje + '</p' 
});
}