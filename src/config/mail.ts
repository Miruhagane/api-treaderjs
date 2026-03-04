import { Resend } from "resend";
import dotenv from 'dotenv';
import { getLogger } from './logger';
const log = getLogger('mail');
dotenv.config();


const resend = new Resend('re_LGhVwTB9_Gubdv1meDToKGaCQMUjfGLgM');


/**
 * Sends an email with an error message.
 * @param asunto - The subject of the email.
 * @param mensaje - The error message to be sent.
 */
export const errorSendEmail = async (asunto: string, mensaje: string) => {
  try {
    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: 'ricardokurosaki23@gmail.com',
      subject: asunto,
      html: `<p><strong>Hubo un error en el servidor</strong>!</p><pre>${mensaje}</pre>`
    });
  } catch (err) {
    // Evita que el rechazo de la librería burbujee sin catch
    try {
      log.error({ err }, 'errorSendEmail failed');
    } catch (_) {
      // ignore logger errors
    }
  }
}