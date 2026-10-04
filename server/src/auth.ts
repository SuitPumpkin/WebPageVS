import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(
      `Falta la variable de entorno ${name}. Copia .env.example a .env y defínela. ` +
        `No hay credenciales por defecto: el servidor no arranca sin ellas.`
    );
  }

  return value;
}

export const ADMIN_USER = requiredEnv('ADMIN_USER');
export const ADMIN_PASS = requiredEnv('ADMIN_PASS');

export function validateLogin(username: string, password: string): boolean {
  return username === ADMIN_USER && password === ADMIN_PASS;
}