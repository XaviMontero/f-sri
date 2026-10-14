import { describe, expect, it } from 'vitest';
import { WithholdingRecord } from '../../../../src/modules/withholding/application/ports';
import { renderWithholdingRideHtml } from '../../../../src/modules/withholding/infrastructure/withholdingRide';
import { ISSUER, ISSUER_RECORD } from '../../../helpers/fakes';
import { buildWithholding } from './fixtures';

function record(overrides: Partial<WithholdingRecord> = {}): WithholdingRecord {
  const w = buildWithholding({ additionalInfo: { Nota: '<b>pago</b>' } });
  return {
    id: 'ret-1',
    issuerId: 'issuer-1',
    documentType: '07',
    accessKey: '1310202607010607978300110010140000000011234567818',
    sequential: '000000001',
    number: '001-014-000000001',
    environment: '1',
    emissionDate: new Date('2026-10-13T00:00:00Z'),
    status: 'AUTORIZADO',
    xml: '<comprobanteRetencion/>',
    authorizationNumber: '1310202607010607978300110010140000000011234567818',
    authorizationDate: new Date('2026-10-13T20:15:30Z'),
    subject: w.subject,
    fiscalPeriod: w.fiscalPeriod,
    totalWithheld: w.totalWithheld,
    supportDocuments: w.supportDocuments,
    additionalInfo: w.additionalInfo,
    ...overrides,
  };
}

describe('renderWithholdingRideHtml', () => {
  it('incluye cabecera, sujeto retenido, detalle de retenciones y total', () => {
    const html = renderWithholdingRideHtml({ document: record(), issuer: ISSUER_RECORD });
    expect(html).toContain('COMPROBANTE DE RETENCIÓN');
    expect(html).toContain('001-014-000000001');
    expect(html).toContain('13/10/2026 15:15:30'); // hora de Ecuador
    expect(html).toContain('PRUEBAS');
    expect(html).toContain('FACTURA 001-009-000000001');
    expect(html).toContain('RENTA');
    expect(html).toContain('<td class="num">10%</td>');
    expect(html).toContain('$1.00');
    expect(html).toContain('<svg');
    expect(html).toContain('Período Fiscal:</td><td>10/2026');
  });

  it('escapa todo dato del cliente', () => {
    const doc = record({
      subject: { idType: '05', id: '0106079783', name: '<script>alert(1)</script>', relatedParty: 'NO' },
    });
    const html = renderWithholdingRideHtml({
      document: doc,
      issuer: { ...ISSUER_RECORD, issuer: { ...ISSUER, businessName: 'A & B', specialTaxpayer: '"5368"' } },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('A &amp; B');
    expect(html).toContain('&quot;5368&quot;');
    expect(html).toContain('&lt;b&gt;pago&lt;/b&gt;');
  });

  it('producción y documento de sustento sin número', () => {
    const base = record();
    const html = renderWithholdingRideHtml({
      document: {
        ...base,
        environment: '2',
        authorizationDate: undefined,
        additionalInfo: {},
        supportDocuments: [{ ...base.supportDocuments[0], documentType: '41', number: undefined }],
      },
      issuer: ISSUER_RECORD,
    });
    expect(html).toContain('PRODUCCIÓN');
    expect(html).toContain('<td>41 </td>');
    expect(html).not.toContain('Información Adicional');
  });
});
