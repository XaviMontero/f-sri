import { EmissionDate } from '../../../../src/domain/invoice/EmissionDate';
import { DebitNote, DebitNoteProps } from '../../../../src/modules/debitNote/domain/DebitNote';
import {
  DebitNoteRecord,
  DebitNoteRepository,
  NewDebitNoteRecord,
} from '../../../../src/modules/debitNote/application/DebitNoteRecord';
import { SriDocumentUpdate } from '../../../../src/application/ports/repositories';
import { ISSUER } from '../../../helpers/fakes';

export function buildDebitNote(overrides: Partial<DebitNoteProps> = {}): DebitNote {
  return DebitNote.create({
    issuer: ISSUER,
    buyer: { idType: '05', id: '0106079783', name: 'MONTERO CAMPOVERDE OSCAR XAVIER' },
    emissionDate: EmissionDate.of(13, 10, 2026),
    modifiedDocument: { type: '01', number: '001-009-000000001', emissionDate: EmissionDate.of(13, 10, 2026) },
    reasons: [{ reason: 'Interés por mora', value: 2 }],
    ...overrides,
  });
}

/** Payload público tal como lo autorizó el SRI (scratchpad nd.json). */
export function ndPayload(overrides: { info?: Record<string, unknown>; motivos?: unknown[]; ruc?: string } = {}) {
  return {
    nota_debito: {
      infoTributaria: { ruc: overrides.ruc ?? '0106079783001', claveAcceso: '', secuencial: '' },
      infoNotaDebito: {
        fechaEmision: '13/10/2026',
        tipoIdentificacionComprador: '05',
        identificacionComprador: '0106079783',
        razonSocialComprador: 'MONTERO CAMPOVERDE OSCAR XAVIER',
        codDocModificado: '01',
        numDocModificado: '001-009-000000001',
        fechaEmisionDocSustento: '13/10/2026',
        totalSinImpuestos: '2.00',
        impuestos: [
          { impuesto: { codigo: '2', codigoPorcentaje: '4', tarifa: '15', baseImponible: '2.00', valor: '0.30' } },
        ],
        valorTotal: '2.30',
        pagos: [{ pago: { formaPago: '01', total: '2.30', plazo: '0', unidadTiempo: 'dias' } }],
        ...overrides.info,
      },
      motivos: overrides.motivos ?? [{ motivo: { razon: 'INTERES POR MORA DE PRUEBA', valor: '2.00' } }],
    },
  };
}

export class InMemoryDebitNotes implements DebitNoteRepository {
  readonly records = new Map<string, DebitNoteRecord>();
  private nextId = 1;
  async create(record: NewDebitNoteRecord) {
    const created = { ...record, id: `nd-${this.nextId++}` };
    this.records.set(created.id, created);
    return created;
  }
  async findById(id: string) {
    return this.records.get(id) ?? null;
  }
  async update(id: string, changes: SriDocumentUpdate) {
    const current = this.records.get(id);
    if (!current) throw new Error(`debit note ${id} not found`);
    const updated = { ...current, ...changes };
    this.records.set(id, updated);
    return updated;
  }
}
