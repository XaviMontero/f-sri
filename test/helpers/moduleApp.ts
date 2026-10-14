import express from 'express';
import jwt from 'jsonwebtoken';
import verifyToken from '../../src/middleware/verifyToken';
import { errorHandler } from '../../src/http/errorHandler';
import { DocumentModule } from '../../src/modules/types';

/** App mínima con un solo módulo montado en `/api/v1/{path}`, auth JWT real y manejo de errores. */
export function moduleApp(module: DocumentModule) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(verifyToken);
  app.use(`/api/v1/${module.path}`, module.router);
  app.use(errorHandler);
  return app;
}

/** Header Authorization para un usuario de la empresa `companyId`. */
export function authFor(companyId: string, userId = 'user-1'): { Authorization: string } {
  const token = jwt.sign({ userId, companyId }, process.env.JWT_SECRET || '', { expiresIn: '1h' });
  return { Authorization: `Bearer ${token}` };
}
