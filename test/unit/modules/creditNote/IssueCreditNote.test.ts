import { describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../../src/domain/shared/errors';
import { AccessKey } from '../../../../src/domain/invoice/AccessKey';
import {
  IssueCreditNote,
  IssueCreditNoteCommand,
} from '../../../../src/modules/creditNote/application/IssueCreditNote';
import { CreditNoteXmlRenderer } from '../../../../src/modules/creditNote/infrastructure/CreditNoteXmlRenderer';
import {
  fixedClock,
  InMemoryBuyers,
  InMemoryIssuers,
  InMemoryProducts,
  InMemorySequences,
  ISSUER_RECORD,
} from '../../../helpers/fakes';
import { InMemoryCreditNotes } from './support';

function setup(opts: { buyers?: InMemoryBuyers; products?: InMemoryProducts } = {}): {
  useCase: IssueCreditNote;
  sequences: InMemorySequences;
  notes: InMemoryCreditNotes;
} {
  const sequences = new InMemorySequences();
  const notes = new InMemoryCreditNotes();
  const useCase = new IssueCreditNote({
    issuers: new InMemoryIssuers(),
    buyers: opts.buyers ?? new InMemoryBuyers(),
    products: opts.products ?? new InMemoryProducts(),
    sequences,
    creditNotes: notes,
    xml: new CreditNoteXmlRenderer(),
    clock: fixedClock(),
    random: () => 0.12345678,
  });
  return { useCase, sequences, notes };
}

function command(overrides: Partial<IssueCreditNoteCommand> = {}): IssueCreditNoteCommand {
  return {
    issuerRuc: ISSUER_RECORD.issuer.ruc,
    emissionDate: '13/10/2026',
    buyer: { idType: '05', id: '0106079783', name: 'MONTERO CAMPOVERDE OSCAR XAVIER' },
    modifiedDocument: { type: '01', number: '001-009-000000001', emissionDate: '13/10/2026' },
    reason: 'DEVOLUCION DE PRUEBA',
    lines: [{ code: 'PRD001', description: 'Servicio de prueba', quantity: 1, unitPrice: 10, ivaCode: '4' }],
    expectedTotals: { subtotal: 10, total: 11.5 },
    ...overrides,
  };
}

describe('IssueCreditNote', () => {
  it('emite PENDIENTE con secuencial, clave de acceso codDoc 04, totales y XML', async () => {
    const { useCase, notes } = setup();
    const nc = await useCase.execute(command(), { companyId: ISSUER_RECORD.id });
    expect(nc.status).toBe('PENDIENTE');
    expect(nc.documentType).toBe('04');
    expect(nc.sequential).toBe('000000001');
    expect(nc.number).toBe('001-001-000000001');
    expect(AccessKey.from(nc.accessKey).value.slice(8, 10)).toBe('04');
    expect(nc.accessKey.slice(24, 39)).toBe('001001000000001');
    expect(nc).toMatchObject({ subtotal: 10, totalTax: 1.5, total: 11.5, issuerId: ISSUER_RECORD.id });
    expect(nc.modifiedDocument).toEqual({
      type: '01',
      number: '001-009-000000001',
      emissionDate: new Date(Date.UTC(2026, 9, 13)),
    });
    expect(nc.taxes).toEqual([{ taxCode: '2', ivaCode: '4', rate: 15, base: 10, value: 1.5 }]);
    expect(nc.xml).toContain('<notaCredito id="comprobante" version="1.1.0">');
    expect(nc.xml).toContain(`<claveAcceso>${nc.accessKey}</claveAcceso>`);
    expect(notes.records.size).toBe(1);
  });

  it('por defecto la fecha de emisión es hoy en Ecuador', async () => {
    const { useCase } = setup();
    const nc = await useCase.execute(
      command({
        emissionDate: undefined,
        modifiedDocument: { type: '01', number: '001-009-000000001', emissionDate: '01/10/2026' },
      }),
    );
    expect(nc.emissionDate).toEqual(new Date(Date.UTC(2026, 9, 13)));
  });

  it('errores de validación NO consumen secuencial', async () => {
    const { useCase, sequences, notes } = setup();
    const invalid: Array<Partial<IssueCreditNoteCommand>> = [
      { modifiedDocument: { type: '01', number: '1-1-1', emissionDate: '13/10/2026' } },
      { modifiedDocument: { type: '01', number: '001-009-000000001', emissionDate: '14/10/2026' } },
      { reason: '' },
      { lines: [] },
      { expectedTotals: { total: 11.49 } },
      { expectedTotals: { subtotal: 9 } },
      { lines: [{ code: 'P', description: 'x', quantity: 1, unitPrice: 10, expectedSubtotal: 9 }] },
      { buyer: { idType: '07', id: '9999999999999', name: 'CONSUMIDOR FINAL' } },
    ];
    for (const overrides of invalid) {
      await expect(useCase.execute(command(overrides))).rejects.toBeInstanceOf(ValidationError);
    }
    expect(sequences.calls).toBe(0);
    expect(notes.records.size).toBe(0);
  });

  it('el emisor de otra empresa → ForbiddenError sin consumir secuencial', async () => {
    const { useCase, sequences } = setup();
    await expect(useCase.execute(command(), { companyId: 'otra-empresa' })).rejects.toBeInstanceOf(ForbiddenError);
    expect(sequences.calls).toBe(0);
  });

  it('RUC desconocido → NotFound (400)', async () => {
    const { useCase } = setup();
    const error = await useCase.execute(command({ issuerRuc: '1790000000001' })).catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.httpStatus).toBe(400);
  });

  it('usa el comprador registrado y completa info adicional con sus datos', async () => {
    const buyers = new InMemoryBuyers([
      {
        idType: '05',
        id: '0106079783',
        name: 'CLIENTE REGISTRADO',
        email: 'c@x.ec',
        phone: '0999',
        recordId: 'client-1',
      },
    ]);
    const { useCase } = setup({ buyers });
    const nc = await useCase.execute(command({ buyer: { idType: '05', id: '0106079783' } }));
    expect(nc.buyer.name).toBe('CLIENTE REGISTRADO');
    expect(nc.buyerRecordId).toBe('client-1');
    expect(nc.additionalInfo).toEqual({ Email: 'c@x.ec', Teléfono: '0999' });
  });

  it('comprador desconocido sin nombre → Client not found', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(command({ buyer: { idType: '05', id: '0106079783' } }))).rejects.toThrow(
      'Client not found',
    );
  });

  it('completa descripción/precio/IVA desde el catálogo de productos', async () => {
    const products = new InMemoryProducts([
      { id: 'p1', code: 'PRD001', description: 'Del catálogo', unitPrice: 4, chargesIva: false },
    ]);
    const { useCase } = setup({ products });
    const nc = await useCase.execute(command({ lines: [{ code: 'PRD001', quantity: 2 }], expectedTotals: {} }));
    expect(nc.lines[0]).toMatchObject({ productId: 'p1', description: 'Del catálogo', unitPrice: 4, ivaCode: '0' });
    expect(nc.total).toBe(8);
  });

  it('producto inexistente sin precio → Product not found', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(command({ lines: [{ code: 'NOPE', quantity: 1 }] }))).rejects.toThrow(
      'Product not found: NOPE',
    );
  });

  it('tarifas mixtas: impuestos agrupados y valorModificacion calculado', async () => {
    const { useCase } = setup();
    const nc = await useCase.execute(
      command({
        lines: [
          { code: 'A', description: 'a', quantity: 1, unitPrice: 10, ivaCode: '4' },
          { code: 'B', description: 'b', quantity: 1, unitPrice: 5, ivaCode: '0' },
        ],
        expectedTotals: { subtotal: 15, total: 16.5 },
      }),
    );
    expect(nc.taxes.map((t) => [t.ivaCode, t.base, t.value])).toEqual([
      ['0', 5, 0],
      ['4', 10, 1.5],
    ]);
    expect(nc.total).toBe(16.5);
  });

  it('secuenciales consecutivos', async () => {
    const { useCase } = setup();
    const a = await useCase.execute(command());
    const b = await useCase.execute(command());
    expect([a.sequential, b.sequential]).toEqual(['000000001', '000000002']);
    expect(a.accessKey).not.toBe(b.accessKey);
  });
});
