import { Request, Router } from 'express';
import InvoicePDF, { IInvoicePDF } from '../models/InvoicePDF';
import Invoice from '../models/Invoice';
import { Container } from '../container';
import { asyncHandler } from '../http/errorHandler';
import { companyIdOf } from '../http/tenant';
import { InvoiceStatus } from '../domain/invoice/InvoiceStatus';
import { NotFoundError, ValidationError } from '../domain/shared/errors';

/** RIDEs (PDF) de las facturas de la empresa del usuario. */
export function createInvoicePdfRouter(container: Container): Router {
  const router = Router();

  const ownInvoiceIds = async (req: Request): Promise<string[]> => {
    const invoices = await Invoice.find({ empresa_emisora_id: companyIdOf(req) })
      .select('_id')
      .lean();
    return invoices.map((i) => String(i._id));
  };

  /** Busca un RIDE y verifica que su factura pertenezca a la empresa del usuario. */
  const findOwnedPdf = async (req: Request, filter: Record<string, unknown>) => {
    const companyId = companyIdOf(req);
    const doc = await InvoicePDF.findOne(filter);
    if (!doc || !(await Invoice.exists({ _id: doc.factura_id, empresa_emisora_id: companyId }))) {
      throw new NotFoundError('PDF not found');
    }
    return doc;
  };

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await InvoicePDF.find({ factura_id: { $in: await ownInvoiceIds(req) } }).lean());
    }),
  );

  router.get(
    '/invoice/:facturaId',
    asyncHandler(async (req, res) => {
      res.json(await findOwnedPdf(req, { factura_id: req.params.facturaId }));
    }),
  );

  router.get(
    '/access-key/:claveAcceso',
    asyncHandler(async (req, res) => {
      res.json(await findOwnedPdf(req, { claveAcceso: req.params.claveAcceso }));
    }),
  );

  /** Redirige a la URL pública del PDF (Cloudinary, almacenamiento local, etc.). */
  router.get(
    '/download/:claveAcceso',
    asyncHandler(async (req, res) => {
      const doc = await findOwnedPdf(req, { claveAcceso: req.params.claveAcceso });
      if (!doc.pdf_url) throw new NotFoundError('PDF URL not available');
      res.redirect(doc.pdf_url);
    }),
  );

  /** Regenera el RIDE de una factura autorizada (p. ej. si falló Chromium o el almacenamiento). */
  router.post(
    '/regenerate/:facturaId',
    asyncHandler(async (req, res) => {
      const invoice = await container.invoices.findById(req.params.facturaId);
      if (!invoice || invoice.issuerId !== companyIdOf(req)) throw new NotFoundError('Factura no encontrada');
      if (invoice.status !== InvoiceStatus.AUTHORIZED) {
        res.status(409).json({ message: `Solo se genera el RIDE de facturas autorizadas (estado: ${invoice.status})` });
        return;
      }
      if (!container.ride) {
        res.status(503).json({ message: 'Generación de RIDE deshabilitada' });
        return;
      }
      await container.ride.publish(invoice);
      res.json(await InvoicePDF.findOne({ claveAcceso: invoice.accessKey }).lean());
    }),
  );

  // El envío real de correos aún no está implementado: estas rutas solo registran la solicitud.
  router.post(
    '/send-email/:claveAcceso',
    asyncHandler(async (req, res) => {
      const { email_destinatario } = req.body ?? {};
      if (!email_destinatario) throw new ValidationError('Email destinatario is required');
      const doc = await findOwnedPdf(req, { claveAcceso: req.params.claveAcceso });
      doc.email_estado = 'PENDIENTE';
      doc.email_destinatario = email_destinatario;
      doc.email_intentos = 0;
      doc.email_ultimo_error = undefined;
      await doc.save();
      res.json({
        message: 'Email sending request queued',
        claveAcceso: req.params.claveAcceso,
        destinatario: email_destinatario,
        estado: 'PENDIENTE',
      });
    }),
  );

  router.get(
    '/email-status/:claveAcceso',
    asyncHandler(async (req, res) => {
      const doc: IInvoicePDF = await findOwnedPdf(req, { claveAcceso: req.params.claveAcceso });
      res.json({
        claveAcceso: req.params.claveAcceso,
        email_estado: doc.email_estado,
        email_destinatario: doc.email_destinatario,
        email_fecha_envio: doc.email_fecha_envio,
        email_intentos: doc.email_intentos,
        email_ultimo_error: doc.email_ultimo_error,
      });
    }),
  );

  router.post(
    '/retry-email/:claveAcceso',
    asyncHandler(async (req, res) => {
      const doc = await findOwnedPdf(req, { claveAcceso: req.params.claveAcceso });
      if (doc.email_estado === 'ENVIADO') throw new ValidationError('Email already sent successfully');
      doc.email_estado = 'PENDIENTE';
      doc.email_ultimo_error = undefined;
      await doc.save();
      res.json({ message: 'Email retry requested', claveAcceso: req.params.claveAcceso, estado: 'PENDIENTE' });
    }),
  );

  return router;
}
