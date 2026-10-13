import { Request } from 'express';
import { ForbiddenError } from '../domain/shared/errors';

/**
 * Empresa emisora del usuario autenticado (claim `companyId` del JWT). Toda operación
 * sobre datos tributarios se acota a ella; un token sin empresa no puede operar.
 */
export function companyIdOf(req: Request): string {
  const companyId = (req as Request & { user?: { companyId?: string } }).user?.companyId;
  if (!companyId) throw new ForbiddenError('El usuario no tiene una empresa emisora asociada');
  return String(companyId);
}
