import { NextFunction, Request, Response } from 'express';
import { DomainError } from '../domain/shared/errors';

/** Traduce errores de dominio a 4xx y oculta el detalle de los 500 fuera de desarrollo. */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof DomainError) {
    res.status(err.httpStatus).json({ success: false, message: err.message });
    return;
  }
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ success: false, message: 'JSON inválido' });
    return;
  }
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal Server Error',
  });
}

/** Envuelve handlers async para que los rechazos lleguen al errorHandler (Express 4). */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);
