import { Request, Router } from 'express';
import Invoice from '../models/Invoice';
import InvoiceDetail from '../models/InvoiceDetail';
import { companyIdOf } from '../http/tenant';
import { Container } from '../container';
import { asyncHandler } from '../http/errorHandler';
import { toIssueInvoiceCommand } from '../http/invoiceRequestMapper';
import { InvoiceRecord } from '../application/ports/repositories';
import { InvoiceStatus } from '../domain/invoice/InvoiceStatus';
import { NotFoundError, ValidationError } from '../domain/shared/errors';

/** Campos pesados que no se devuelven en listados. */
const HEAVY_FIELDS = '-xml -xml_firmado -xml_autorizado -ride_pdf -datos_originales';

function companyScope(req: Request): Record<string, unknown> {
  return { empresa_emisora_id: companyIdOf(req) };
}

function wantsToWait(req: Request): boolean {
  const flag = String(req.query.esperar ?? req.query.wait ?? '').toLowerCase();
  return flag === 'true' || flag === '1';
}

/** Vista pública del estado de una factura frente al SRI. */
export function invoiceSummary(invoice: InvoiceRecord) {
  return {
    id: invoice.id,
    numero: invoice.number,
    secuencial: invoice.sequential,
    clave_acceso: invoice.accessKey,
    ambiente: invoice.environment === '2' ? 'PRODUCCION' : 'PRUEBAS',
    estado: invoice.status,
    numero_autorizacion: invoice.authorizationNumber ?? null,
    fecha_autorizacion: invoice.authorizationDate ?? null,
    total_sin_impuestos: invoice.subtotal,
    total_iva: invoice.totalTax,
    importe_total: invoice.total,
    mensajes: invoice.messages ?? [],
  };
}

export function createInvoiceRouter(container: Container): Router {
  const router = Router();

  const loadOwned = async (req: Request): Promise<InvoiceRecord> => {
    const companyId = companyIdOf(req);
    const invoice = await container.invoices.findById(req.params.id);
    if (!invoice || invoice.issuerId !== companyId) throw new NotFoundError('Factura no encontrada');
    return invoice;
  };

  /**
   * Emite una factura: valida, calcula totales, genera XML, firma XAdES-BES y la envía al SRI.
   * Con `?esperar=true` responde cuando el SRI autoriza (o rechaza); sin él, responde al
   * persistirla y el envío continúa en segundo plano.
   */
  router.post(
    '/complete',
    asyncHandler(async (req, res) => {
      if (!req.body?.factura) throw new ValidationError('Invoice data is required');
      const command = toIssueInvoiceCommand(req.body.factura);
      const created = await container.issueInvoice.execute(command, { companyId: companyIdOf(req) });

      if (wantsToWait(req)) {
        const processed = await container.submitInvoice.execute(created.id);
        res.status(201).json({
          success: processed.status === InvoiceStatus.AUTHORIZED,
          data: invoiceSummary(processed),
          xml: created.xml,
        });
        return;
      }
      container.submitInvoice.execute(created.id).catch((error) => {
        container.logger.error('Error en el envío asíncrono al SRI', {
          id: created.id,
          error: (error as Error).message,
        });
      });
      res.status(201).json({ success: true, data: invoiceSummary(created), xml: created.xml });
    }),
  );

  /** Reintenta firma/envío/autorización (idempotente: retoma desde el último paso). */
  router.post(
    '/:id/enviar',
    asyncHandler(async (req, res) => {
      const invoice = await loadOwned(req);
      const processed = await container.submitInvoice.execute(invoice.id);
      res.json({ success: processed.status === InvoiceStatus.AUTHORIZED, data: invoiceSummary(processed) });
    }),
  );

  router.get(
    '/:id/estado',
    asyncHandler(async (req, res) => {
      res.json(invoiceSummary(await loadOwned(req)));
    }),
  );

  /** XML autorizado (o firmado, si aún no hay autorización) para entregar al comprador. */
  router.get(
    '/:id/xml',
    asyncHandler(async (req, res) => {
      const invoice = await loadOwned(req);
      const xml = invoice.authorizedXml ?? invoice.signedXml ?? invoice.xml;
      res.type('application/xml').attachment(`${invoice.accessKey}.xml`).send(xml);
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await Invoice.find(companyScope(req)).select(HEAVY_FIELDS).sort({ createdAt: -1 }).lean());
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      await loadOwned(req);
      res.json(await Invoice.findById(req.params.id).lean());
    }),
  );

  /** Solo se pueden eliminar borradores: una factura autorizada es un documento tributario. */
  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const invoice = await loadOwned(req);
      if (invoice.status === InvoiceStatus.AUTHORIZED) {
        res.status(409).json({ message: 'Una factura autorizada no se puede eliminar; emita una nota de crédito' });
        return;
      }
      await Invoice.findByIdAndDelete(invoice.id);
      await InvoiceDetail.deleteMany({ factura_id: invoice.id });
      res.json({ message: 'Deleted' });
    }),
  );

  return router;
}
