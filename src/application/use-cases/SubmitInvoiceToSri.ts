import { InvoiceRecord, InvoiceRepository } from '../ports/repositories';
import { SubmitDocumentDeps, SubmitDocumentToSri } from './SubmitDocumentToSri';

export type { SubmitOptions } from './SubmitDocumentToSri';

export interface SubmitInvoiceDeps extends Omit<SubmitDocumentDeps<InvoiceRecord>, 'documents'> {
  invoices: InvoiceRepository;
}

/** {@link SubmitDocumentToSri} para facturas (codDoc 01). */
export class SubmitInvoiceToSri extends SubmitDocumentToSri<InvoiceRecord> {
  constructor({ invoices, ...deps }: SubmitInvoiceDeps) {
    super({ ...deps, documents: invoices });
  }
}
