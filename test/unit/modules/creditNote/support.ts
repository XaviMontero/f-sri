import { AccessKey } from '../../../../src/domain/invoice/AccessKey';
import { EmissionDate } from '../../../../src/domain/invoice/EmissionDate';
import { InvoiceLineProps } from '../../../../src/domain/invoice/InvoiceLine';
import { CreditNote, CreditNoteProps } from '../../../../src/modules/creditNote/domain/CreditNote';
import {
  CreditNoteRecord,
  CreditNoteRepository,
  NewCreditNoteRecord,
} from '../../../../src/modules/creditNote/application/IssueCreditNote';
import { SriDocumentUpdate } from '../../../../src/application/ports/repositories';
import { ISSUER } from '../../../helpers/fakes';

export const ncLine = (overrides: Partial<InvoiceLineProps> = {}): InvoiceLineProps => ({
  code: 'PRD001',
  description: 'Servicio de prueba',
  quantity: 1,
  unitPrice: 10,
  ivaCode: '4',
  ...overrides,
});

export function creditNoteProps(overrides: Partial<CreditNoteProps> = {}): CreditNoteProps {
  return {
    issuer: ISSUER,
    buyer: { idType: '05', id: '0106079783', name: 'MONTERO CAMPOVERDE OSCAR XAVIER' },
    emissionDate: EmissionDate.of(13, 10, 2026),
    modifiedDocument: { type: '01', number: '001-009-000000001', emissionDate: EmissionDate.of(13, 10, 2026) },
    reason: 'DEVOLUCION DE PRUEBA',
    lines: [ncLine()],
    ...overrides,
  };
}

export function numberedCreditNote(overrides: Partial<CreditNoteProps> = {}, sequential = '000000007'): CreditNote {
  const props = creditNoteProps(overrides);
  const accessKey = AccessKey.generate({
    emissionDate: props.emissionDate,
    documentType: '04',
    ruc: props.issuer.ruc,
    environment: props.issuer.environment,
    series: `${props.issuer.establishment}${props.issuer.emissionPoint}`,
    sequential,
    numericCode: '12345678',
    emissionType: '1',
  });
  return CreditNote.create(props).numbered({ sequential, accessKey });
}

export class InMemoryCreditNotes implements CreditNoteRepository {
  readonly records = new Map<string, CreditNoteRecord>();
  private nextId = 1;
  async create(record: NewCreditNoteRecord) {
    const created = { ...record, id: `nc-${this.nextId++}` };
    this.records.set(created.id, created);
    return created;
  }
  async findById(id: string) {
    return this.records.get(id) ?? null;
  }
  async update(id: string, changes: SriDocumentUpdate) {
    const current = this.records.get(id);
    if (!current) throw new Error(`credit note ${id} not found`);
    const updated = { ...current, ...changes };
    this.records.set(id, updated);
    return updated;
  }
}
