import { SriDocumentRecord, SriDocumentRepository } from '../../../application/ports/repositories';
import { SupportDocument, Withholding, WithholdingSubject } from '../domain/Withholding';

/** Comprobante de retención persistido. */
export interface WithholdingRecord extends SriDocumentRecord {
  subject: WithholdingSubject;
  /** mm/aaaa. */
  fiscalPeriod: string;
  totalWithheld: number;
  supportDocuments: SupportDocument[];
  additionalInfo?: Record<string, string>;
  request?: unknown;
}

export type NewWithholdingRecord = Omit<WithholdingRecord, 'id'>;

export interface WithholdingRepository extends SriDocumentRepository<WithholdingRecord> {
  create(record: NewWithholdingRecord): Promise<WithholdingRecord>;
}

/** Serializa el agregado al XML `comprobanteRetencion` 2.0.0. */
export interface WithholdingXmlRenderer {
  render(withholding: Withholding, keys: { accessKey: string; sequential: string }): string;
}
