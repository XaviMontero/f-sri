import { SriDocumentRecord, SriDocumentRepository } from '../../../application/ports/repositories';
import { Buyer, Payment } from '../../../domain/invoice/Invoice';
import { DebitNote } from '../domain/DebitNote';

export interface DebitNoteTaxRecord {
  taxCode: string;
  ivaCode: string;
  rate: number;
  base: number;
  value: number;
}

/** Nota de débito persistida (estado SRI común + datos propios). */
export interface DebitNoteRecord extends SriDocumentRecord {
  buyerRecordId?: string;
  buyer: Buyer;
  modifiedDocument: { type: string; number: string; emissionDate: Date };
  reasons: Array<{ reason: string; value: number; ivaCode?: string }>;
  taxes: DebitNoteTaxRecord[];
  subtotal: number;
  totalTax: number;
  total: number;
  payments: Payment[];
  additionalInfo?: Record<string, string>;
  request?: unknown;
}

export type NewDebitNoteRecord = Omit<DebitNoteRecord, 'id'>;

export interface DebitNoteRepository extends SriDocumentRepository<DebitNoteRecord> {
  create(record: NewDebitNoteRecord): Promise<DebitNoteRecord>;
}

/** Serializa la nota de débito al XML del SRI con su numeración ya asignada. */
export interface DebitNoteXmlRenderer {
  render(note: DebitNote, numbering: { accessKey: string; sequential: string }): string;
}
