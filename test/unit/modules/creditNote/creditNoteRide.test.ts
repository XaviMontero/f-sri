import { describe, expect, it } from 'vitest';
import { CreditNoteRecord } from '../../../../src/modules/creditNote/application/IssueCreditNote';
import { renderCreditNoteRideHtml } from '../../../../src/modules/creditNote/infrastructure/creditNoteRide';
import { creditNoteSummary } from '../../../../src/modules/creditNote';
import { ISSUER_RECORD } from '../../../helpers/fakes';

function record(overrides: Partial<CreditNoteRecord> = {}): CreditNoteRecord {
  return {
    id: 'nc-1',
    issuerId: ISSUER_RECORD.id,
    documentType: '04',
    accessKey: '1310202604010607978300110010110000000011234567812',
    sequential: '000000001',
    number: '001-011-000000001',
    environment: '1',
    emissionDate: new Date(Date.UTC(2026, 9, 13)),
    status: 'AUTORIZADO',
    xml: '<notaCredito/>',
    authorizationNumber: '1310202604010607978300110010110000000011234567812',
    authorizationDate: new Date('2026-10-13T20:00:00Z'),
    buyer: { idType: '05', id: '0106079783', name: 'MONTERO <b>' },
    modifiedDocument: { type: '01', number: '001-009-000000001', emissionDate: new Date(Date.UTC(2026, 9, 13)) },
    reason: 'DEVOLUCION <script>alert(1)</script>',
    subtotal: 15,
    totalTax: 1.5,
    total: 16.5,
    taxes: [
      { taxCode: '2', ivaCode: '0', rate: 0, base: 5, value: 0 },
      { taxCode: '2', ivaCode: '4', rate: 15, base: 10, value: 1.5 },
    ],
    lines: [
      {
        code: 'A&B',
        description: 'Producto "x"',
        quantity: 1,
        unitPrice: 10,
        discount: 0,
        subtotal: 10,
        ivaCode: '4',
        ivaRate: 15,
        taxValue: 1.5,
      },
    ],
    additionalInfo: { '<k>': '<v>' },
    ...overrides,
  };
}

describe('RIDE de nota de crédito', () => {
  it('muestra documento modificado, motivo, subtotales por tarifa y total', () => {
    const html = renderCreditNoteRideHtml({ document: record(), issuer: ISSUER_RECORD });
    expect(html).toContain('NOTA DE CRÉDITO');
    expect(html).toContain('001-011-000000001');
    expect(html).toContain('FACTURA');
    expect(html).toContain('001-009-000000001');
    expect(html).toContain('13/10/2026');
    expect(html).toContain('SUBTOTAL 15%');
    expect(html).toContain('SUBTOTAL 0%');
    expect(html).toContain('$16.50');
    expect(html).toContain('<svg');
  });

  it('escapa todos los datos del cliente', () => {
    const html = renderCreditNoteRideHtml({ document: record(), issuer: ISSUER_RECORD });
    expect(html).not.toContain('<script>');
    expect(html).toContain('DEVOLUCION &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('MONTERO &lt;b&gt;');
    expect(html).toContain('A&amp;B');
    expect(html).toContain('Producto &quot;x&quot;');
    expect(html).toContain('&lt;k&gt;');
  });

  it('summary incluye documento modificado y valor', () => {
    expect(creditNoteSummary(record())).toMatchObject({
      tipo_comprobante: '04',
      estado: 'AUTORIZADO',
      num_doc_modificado: '001-009-000000001',
      valor_modificacion: 16.5,
    });
  });
});
