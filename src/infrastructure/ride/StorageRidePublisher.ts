import IssuingCompany, { IIssuingCompany } from '../../models/IssuingCompany';
import InvoicePDF from '../../models/InvoicePDF';
import { InvoiceRecord, RidePublisher } from '../../application/ports/repositories';
import { IPDFStorageProvider } from '../../interfaces/pdf-storage.interface';
import { RideData } from '../../utils/pdf.utils';
import { toIssuerRecord } from '../persistence/MongoIssuerRepository';

export interface StorageRidePublisherDeps {
  storage: () => IPDFStorageProvider;
  renderPdf: (data: RideData) => Promise<Buffer>;
}

/** Genera el RIDE de una factura autorizada, lo sube al almacenamiento configurado y lo registra. */
export class StorageRidePublisher implements RidePublisher {
  constructor(private readonly deps: StorageRidePublisherDeps) {}

  async publish(invoice: InvoiceRecord): Promise<void> {
    const company = await IssuingCompany.findById(invoice.issuerId).lean<IIssuingCompany>();
    if (!company) throw new Error('Empresa emisora no encontrada para el RIDE');

    const pdf = await this.deps.renderPdf({ invoice, issuer: toIssuerRecord(company) });
    const storage = this.deps.storage();
    const uploaded = await storage.upload(pdf, `factura_${invoice.sequential}_${invoice.accessKey}`);

    await InvoicePDF.findOneAndUpdate(
      { claveAcceso: invoice.accessKey },
      {
        factura_id: invoice.id,
        claveAcceso: invoice.accessKey,
        pdf_url: uploaded.url,
        pdf_public_id: uploaded.publicId,
        pdf_provider: uploaded.provider,
        tamano_archivo: uploaded.size,
        numero_autorizacion: invoice.authorizationNumber ?? invoice.accessKey,
        fecha_autorizacion: invoice.authorizationDate ?? new Date(),
        estado: 'GENERADO',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
}
