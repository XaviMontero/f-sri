import { describe, expect, it } from 'vitest';
import { DebitNoteRecord } from '../../../../src/modules/debitNote/application/DebitNoteRecord';
import {
  createDebitNoteRidePublisher,
  renderDebitNoteRideHtml,
} from '../../../../src/modules/debitNote/infrastructure/debitNoteRide';
import { ISSUER_RECORD } from '../../../helpers/fakes';

const doc: DebitNoteRecord = {
  id: 'nd-1',
  issuerId: 'issuer-1',
  documentType: '05',
  accessKey: '1310202605010607978300110010120000000011234567811',
  sequential: '000000001',
  number: '001-012-000000001',
  environment: '1',
  emissionDate: new Date('2026-10-13T00:00:00Z'),
  status: 'AUTORIZADO',
  xml: '<notaDebito/>',
  authorizationDate: new Date('2026-10-13T20:00:00Z'),
  buyer: { idType: '05', id: '0106079783', name: '<script>alert(1)</script>' },
  modifiedDocument: { type: '01', number: '001-009-000000001', emissionDate: new Date('2026-10-13T00:00:00Z') },
  reasons: [{ reason: 'Mora & "gastos"', value: 2 }],
  taxes: [{ taxCode: '2', ivaCode: '4', rate: 15, base: 2, value: 0.3 }],
  subtotal: 2,
  totalTax: 0.3,
  total: 2.3,
  payments: [{ method: '01', amount: 2.3 }],
  additionalInfo: { Email: 'a@b.ec' },
};

describe('RIDE nota de débito', () => {
  it('renderiza datos del documento modificado, motivos y totales, escapando datos de usuario', () => {
    const html = renderDebitNoteRideHtml({ document: doc, issuer: ISSUER_RECORD });
    expect(html).toContain('NOTA DE DÉBITO');
    expect(html).toContain('FACTURA 001-009-000000001');
    expect(html).toContain('13/10/2026 15:00:00');
    expect(html).toContain('$2.30');
    expect(html).toContain('IVA 15%');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Mora &amp; &quot;gastos&quot;');
    expect(html).toContain('<svg');
  });

  it('sin infraestructura de RIDE no hay publicador', () => {
    expect(createDebitNoteRidePublisher(null)).toBeUndefined();
    expect(
      createDebitNoteRidePublisher({ storage: () => ({}) as never, htmlToPdf: async () => Buffer.from('') }),
    ).toBeDefined();
  });
});
