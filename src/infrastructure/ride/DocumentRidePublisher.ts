import IssuingCompany, { IIssuingCompany } from '../../models/IssuingCompany';
import InvoicePDF from '../../models/InvoicePDF';
import { IssuerRecord, RidePublisher, SriDocumentRecord } from '../../application/ports/repositories';
import { IPDFStorageProvider } from '../../interfaces/pdf-storage.interface';
import { toIssuerRecord } from '../persistence/MongoIssuerRepository';

export interface DocumentRidePublisherDeps<T extends SriDocumentRecord> {
  storage: () => IPDFStorageProvider;
  renderPdf: (data: { document: T; issuer: IssuerRecord }) => Promise<Buffer>;
  /** Prefijo del archivo, p. ej. "nota_credito". */
  filePrefix: string;
}

/**
 * RIDE de cualquier comprobante autorizado: lo renderiza, lo sube al almacenamiento
 * configurado y lo registra (colección de PDFs, indexada por clave de acceso).
 */
export class DocumentRidePublisher<T extends SriDocumentRecord> implements RidePublisher<T> {
  constructor(private readonly deps: DocumentRidePublisherDeps<T>) {}

  async publish(document: T): Promise<void> {
    const company = await IssuingCompany.findById(document.issuerId).lean<IIssuingCompany>();
    if (!company) throw new Error('Empresa emisora no encontrada para el RIDE');

    const pdf = await this.deps.renderPdf({ document, issuer: toIssuerRecord(company) });
    const uploaded = await this.deps
      .storage()
      .upload(pdf, `${this.deps.filePrefix}_${document.sequential}_${document.accessKey}`);

    await InvoicePDF.findOneAndUpdate(
      { claveAcceso: document.accessKey },
      {
        factura_id: document.id,
        tipo_documento: document.documentType,
        claveAcceso: document.accessKey,
        pdf_url: uploaded.url,
        pdf_public_id: uploaded.publicId,
        pdf_provider: uploaded.provider,
        tamano_archivo: uploaded.size,
        numero_autorizacion: document.authorizationNumber ?? document.accessKey,
        fecha_autorizacion: document.authorizationDate ?? new Date(),
        estado: 'GENERADO',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
}
