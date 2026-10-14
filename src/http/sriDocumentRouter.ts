import { Request, Router } from 'express';
import { Model } from 'mongoose';
import { RidePublisher, SriDocumentRecord, SriDocumentRepository } from '../application/ports/repositories';
import { Logger } from '../application/ports/runtime';
import { Actor } from '../application/use-cases/IssueInvoice';
import { SubmitDocumentToSri } from '../application/use-cases/SubmitDocumentToSri';
import { DocumentStatus } from '../domain/sri/DocumentStatus';
import { NotFoundError } from '../domain/shared/errors';
import InvoicePDF from '../models/InvoicePDF';
import { asyncHandler } from './errorHandler';
import { companyIdOf } from './tenant';

/** Campos pesados que no se devuelven en listados. */
const HEAVY_FIELDS = '-xml -xml_firmado -xml_autorizado -ride_pdf -datos_originales';

export interface SriDocumentRouterOptions<T extends SriDocumentRecord> {
  /** Nombre en mensajes, p. ej. "Nota de crédito". */
  label: string;
  /** Modelo Mongo para listados y borrado. */
  model: Model<any>;
  documents: SriDocumentRepository<T>;
  /** Valida el body y emite el comprobante (queda PENDIENTE). */
  issue(body: any, actor: Actor): Promise<T>;
  submit: SubmitDocumentToSri<T>;
  /** Vista pública; por defecto, los campos comunes de estado SRI. */
  summary?(document: T): Record<string, unknown>;
  ride?: RidePublisher<T>;
  logger: Logger;
  /** Limpieza adicional al borrar un borrador (p. ej. detalles). */
  onDelete?(id: string): Promise<void>;
}

function wantsToWait(req: Request): boolean {
  const flag = String(req.query.esperar ?? req.query.wait ?? '').toLowerCase();
  return flag === 'true' || flag === '1';
}

/** Estado común de cualquier comprobante frente al SRI. */
export function sriDocumentSummary(document: SriDocumentRecord): Record<string, unknown> {
  return {
    id: document.id,
    tipo_comprobante: document.documentType,
    numero: document.number,
    secuencial: document.sequential,
    clave_acceso: document.accessKey,
    ambiente: document.environment === '2' ? 'PRODUCCION' : 'PRUEBAS',
    estado: document.status,
    numero_autorizacion: document.authorizationNumber ?? null,
    fecha_autorizacion: document.authorizationDate ?? null,
    mensajes: document.messages ?? [],
  };
}

/**
 * Rutas estándar de un comprobante electrónico, acotadas a la empresa del token:
 * emitir (`/complete[?esperar=true]`), reintentar, estado, XML, RIDE, listar, obtener y borrar borradores.
 */
export function createSriDocumentRouter<T extends SriDocumentRecord>(options: SriDocumentRouterOptions<T>): Router {
  const router = Router();
  const summary = options.summary ?? sriDocumentSummary;

  const loadOwned = async (req: Request): Promise<T> => {
    const companyId = companyIdOf(req);
    const document = await options.documents.findById(req.params.id);
    if (!document || document.issuerId !== companyId) throw new NotFoundError(`${options.label} no encontrada`);
    return document;
  };

  router.post(
    '/complete',
    asyncHandler(async (req, res) => {
      const created = await options.issue(req.body, { companyId: companyIdOf(req) });
      if (wantsToWait(req)) {
        const processed = await options.submit.execute(created.id);
        res.status(201).json({
          success: processed.status === DocumentStatus.AUTHORIZED,
          data: summary(processed),
          xml: created.xml,
        });
        return;
      }
      options.submit.execute(created.id).catch((error) => {
        options.logger.error(`Error en el envío asíncrono al SRI (${options.label})`, {
          id: created.id,
          error: (error as Error).message,
        });
      });
      res.status(201).json({ success: true, data: summary(created), xml: created.xml });
    }),
  );

  router.post(
    '/:id/enviar',
    asyncHandler(async (req, res) => {
      const processed = await options.submit.execute((await loadOwned(req)).id);
      res.json({ success: processed.status === DocumentStatus.AUTHORIZED, data: summary(processed) });
    }),
  );

  router.get(
    '/:id/estado',
    asyncHandler(async (req, res) => {
      res.json(summary(await loadOwned(req)));
    }),
  );

  router.get(
    '/:id/xml',
    asyncHandler(async (req, res) => {
      const document = await loadOwned(req);
      const xml = document.authorizedXml ?? document.signedXml ?? document.xml;
      res.type('application/xml').attachment(`${document.accessKey}.xml`).send(xml);
    }),
  );

  /** RIDE del comprobante: metadatos y URL pública. `POST` lo (re)genera si está autorizado. */
  router.get(
    '/:id/pdf',
    asyncHandler(async (req, res) => {
      const document = await loadOwned(req);
      const pdf = await InvoicePDF.findOne({ claveAcceso: document.accessKey }).lean();
      if (!pdf) throw new NotFoundError('PDF not found');
      res.json(pdf);
    }),
  );

  router.post(
    '/:id/pdf',
    asyncHandler(async (req, res) => {
      const document = await loadOwned(req);
      if (document.status !== DocumentStatus.AUTHORIZED) {
        res
          .status(409)
          .json({ message: `Solo se genera el RIDE de comprobantes autorizados (estado: ${document.status})` });
        return;
      }
      if (!options.ride) {
        res.status(503).json({ message: 'Generación de RIDE deshabilitada' });
        return;
      }
      await options.ride.publish(document);
      res.json(await InvoicePDF.findOne({ claveAcceso: document.accessKey }).lean());
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(
        await options.model
          .find({ empresa_emisora_id: companyIdOf(req) })
          .select(HEAVY_FIELDS)
          .sort({ createdAt: -1 })
          .lean(),
      );
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      await loadOwned(req);
      res.json(await options.model.findById(req.params.id).lean());
    }),
  );

  /** Un comprobante autorizado es un documento tributario: no se elimina. */
  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const document = await loadOwned(req);
      if (document.status === DocumentStatus.AUTHORIZED) {
        res.status(409).json({ message: `${options.label} autorizada no se puede eliminar` });
        return;
      }
      await options.model.findByIdAndDelete(document.id);
      await options.onDelete?.(document.id);
      res.json({ message: 'Deleted' });
    }),
  );

  return router;
}
