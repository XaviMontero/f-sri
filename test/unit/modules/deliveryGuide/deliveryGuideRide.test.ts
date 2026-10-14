import { describe, expect, it } from 'vitest';
import { DeliveryGuideRecord } from '../../../../src/modules/deliveryGuide/application/ports';
import { renderDeliveryGuideRideHtml } from '../../../../src/modules/deliveryGuide/infrastructure/deliveryGuideRide';
import { ISSUER_RECORD } from '../../../helpers/fakes';
import { recipient } from './builders';

const ACCESS_KEY = '1310202606010607978300110010010000000071234567813';

function record(overrides: Partial<DeliveryGuideRecord> = {}): DeliveryGuideRecord {
  return {
    id: 'gr-1',
    issuerId: 'issuer-1',
    documentType: '06',
    accessKey: ACCESS_KEY,
    sequential: '000000007',
    number: '001-001-000000007',
    environment: '1',
    emissionDate: new Date('2026-10-13T00:00:00Z'),
    status: 'AUTORIZADO',
    xml: '<guiaRemision/>',
    authorizationNumber: ACCESS_KEY,
    authorizationDate: new Date('2026-10-13T20:30:00Z'),
    departureAddress: 'CUENCA',
    carrier: { idType: '05', id: '0106079783', name: 'TRANSPORTES <S.A.>' },
    transportStart: new Date('2026-10-13T00:00:00Z'),
    transportEnd: new Date('2026-10-14T00:00:00Z'),
    plate: 'ABC1234',
    recipients: [recipient({ items: [{ internalCode: 'P1', description: 'Caja & <b>tapa</b>', quantity: 0.5 }] })],
    additionalInfo: { Email: 'x@y.ec' },
    ...overrides,
  };
}

describe('renderDeliveryGuideRideHtml', () => {
  const html = renderDeliveryGuideRideHtml({ document: record(), issuer: ISSUER_RECORD });

  it('incluye cabecera, número, autorización (hora Ecuador) y código de barras', () => {
    expect(html).toContain('GUÍA DE REMISIÓN');
    expect(html).toContain('001-001-000000007');
    expect(html).toContain(ACCESS_KEY);
    expect(html).toContain('13/10/2026 15:30:00');
    expect(html).toContain('<svg');
  });

  it('muestra transporte y destinatarios sin valores monetarios', () => {
    expect(html).toContain('ABC1234');
    expect(html).toContain('13/10/2026');
    expect(html).toContain('14/10/2026');
    expect(html).toContain('CEDULA');
    expect(html).toContain('FACTURA 001-009-000000001');
    expect(html).toContain('0.50');
    expect(html).toContain('x@y.ec');
    expect(html).not.toContain('$');
  });

  it('escapa los datos del cliente', () => {
    expect(html).toContain('TRANSPORTES &lt;S.A.&gt;');
    expect(html).toContain('Caja &amp; &lt;b&gt;tapa&lt;/b&gt;');
    expect(html).not.toContain('<b>tapa</b>');
  });
});
