import { describe, expect, it, vi } from 'vitest';

// Nunca lanzar Chromium en pruebas unitarias.
vi.mock('puppeteer', () => ({
  default: { launch: vi.fn(() => Promise.reject(new Error('puppeteer no permitido en unit tests'))) },
}));

import { InvoiceRecord } from '../../../src/application/ports/repositories';
import { InvoiceStatus } from '../../../src/domain/invoice/InvoiceStatus';
import { accessKeyBarcodeSvg, escapeHtml, renderRideHtml } from '../../../src/utils/pdf.utils';
import { ISSUER, ISSUER_RECORD } from '../../helpers/fakes';

const KEY = '1310202601010607978300110010010000001231234567819';

const invoice = (overrides: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id: 'inv-1',
  issuerId: 'issuer-1',
  buyer: {
    idType: '05',
    id: '0102030405',
    name: 'JUAN PEREZ',
    address: 'Av. Loja',
    email: 'juan@x.com',
    phone: '0999',
  },
  accessKey: KEY,
  sequential: '000000123',
  number: '001-001-000000123',
  environment: '1',
  emissionDate: new Date('2026-10-13T00:00:00Z'),
  subtotal: 30,
  totalTax: 3,
  total: 33,
  status: InvoiceStatus.AUTHORIZED,
  xml: '<factura/>',
  authorizationNumber: KEY,
  authorizationDate: new Date('2026-10-13T20:06:18Z'),
  lines: [
    {
      code: 'A',
      description: 'Hosting',
      quantity: 2,
      unitPrice: 10,
      discount: 0,
      subtotal: 20,
      ivaCode: '4',
      ivaRate: 15,
      taxValue: 3,
    },
    {
      code: 'B',
      description: 'Libro',
      quantity: 1,
      unitPrice: 10.5,
      discount: 0.5,
      subtotal: 10,
      ivaCode: '0',
      ivaRate: 0,
      taxValue: 0,
    },
  ],
  ...overrides,
});

describe('escapeHtml', () => {
  it('escapa & < > " \'', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
  it('null/undefined → cadena vacía; números a texto', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(12)).toBe('12');
  });
});

describe('accessKeyBarcodeSvg', () => {
  it('genera un <svg> Code128 con barras', () => {
    const svg = accessKeyBarcodeSvg(KEY);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('http://www.w3.org/2000/svg');
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThan(20);
  });
  it('claves distintas producen códigos distintos', () => {
    expect(accessKeyBarcodeSvg(KEY)).not.toBe(accessKeyBarcodeSvg(KEY.replace(/^1/, '2')));
  });
});

describe('renderRideHtml', () => {
  it('incluye clave de acceso, número, autorización y código de barras', () => {
    const html = renderRideHtml({ invoice: invoice(), issuer: ISSUER_RECORD });
    expect(html).toContain(KEY);
    expect(html).toContain('001-001-000000123');
    expect(html).toMatch(/<div class="barcode"><svg[^>]*>/);
    expect(html).toContain('13/10/2026 15:06:18'); // hora de Ecuador (UTC-5)
    expect(html).toContain('Fecha Emisión:</td><td>13/10/2026</td>');
    expect(html).toContain(ISSUER.businessName);
    expect(html).toContain('OBLIGADO A LLEVAR CONTABILIDAD:</strong> NO');
  });

  it('escapa inyección HTML en comprador, descripciones y emisor', () => {
    const html = renderRideHtml({
      invoice: invoice({
        buyer: { idType: '05', id: '0102030405', name: '<script>alert(1)</script>' },
        additionalInfo: { '<b>Nota</b>': '"><img src=x onerror=alert(2)>' },
        lines: [
          {
            code: 'X<b>',
            description: '<img src=x onerror=alert(3)>',
            quantity: 1,
            unitPrice: 1,
            discount: 0,
            subtotal: 1,
            ivaCode: '4',
            ivaRate: 15,
            taxValue: 0.15,
          },
        ],
      }),
      issuer: {
        ...ISSUER_RECORD,
        issuer: { ...ISSUER, tradeName: '<i>Tienda</i>', establishmentAddress: 'Calle & 5' },
      },
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<i>Tienda');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(2)&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(3)&gt;');
    expect(html).toContain('X&lt;b&gt;');
    expect(html).toContain('<td class="label">&lt;b&gt;Nota&lt;/b&gt;</td>');
    expect(html).toContain('Calle &amp; 5');
  });

  it('una fila de subtotal por tarifa de IVA', () => {
    const html = renderRideHtml({
      invoice: invoice({
        lines: [
          ...invoice().lines,
          {
            code: 'C',
            description: 'Otro',
            quantity: 1,
            unitPrice: 5,
            discount: 0,
            subtotal: 5,
            ivaCode: '4',
            ivaRate: 15,
            taxValue: 0.75,
          },
          {
            code: 'D',
            description: 'Exento',
            quantity: 1,
            unitPrice: 1,
            discount: 0,
            subtotal: 1,
            ivaCode: '7',
            ivaRate: 0,
            taxValue: 0,
          },
          {
            code: 'E',
            description: 'Raro',
            quantity: 1,
            unitPrice: 1,
            discount: 0,
            subtotal: 1,
            ivaCode: '99',
            ivaRate: 0,
            taxValue: 0,
          },
        ],
      }),
      issuer: ISSUER_RECORD,
    });
    expect(html).toContain('SUBTOTAL 15%</td><td class="amount">$25.00');
    expect(html).toContain('SUBTOTAL 0%</td><td class="amount">$10.00');
    expect(html).toContain('SUBTOTAL EXENTO DE IVA</td><td class="amount">$1.00');
    expect(html).toContain('SUBTOTAL 99</td>');
    expect(html.match(/SUBTOTAL (15%|0%|EXENTO DE IVA|99)</g)).toHaveLength(4);
    expect(html).toContain('TOTAL DESCUENTO</td><td class="amount">$0.50');
    expect(html).toContain('<strong>$33.00</strong>');
  });

  it('AMBIENTE: PRUEBAS vs PRODUCCIÓN', () => {
    expect(renderRideHtml({ invoice: invoice({ environment: '1' }), issuer: ISSUER_RECORD })).toContain(
      'AMBIENTE:</strong> PRUEBAS',
    );
    expect(renderRideHtml({ invoice: invoice({ environment: '2' }), issuer: ISSUER_RECORD })).toContain(
      'AMBIENTE:</strong> PRODUCCIÓN',
    );
  });

  it('formas de pago: por defecto 01 por el total, o las enviadas', () => {
    const def = renderRideHtml({ invoice: invoice(), issuer: ISSUER_RECORD });
    expect(def).toContain('<td>SIN UTILIZACION DEL SISTEMA FINANCIERO</td><td class="amount">$33.00</td>');
    const custom = renderRideHtml({
      invoice: invoice({
        payments: [
          { method: '19', amount: 30 },
          { method: 'ZZ', amount: 3 },
        ],
      }),
      issuer: ISSUER_RECORD,
    });
    expect(custom).toContain('<td>TARJETA DE CRÉDITO</td><td class="amount">$30.00</td>');
    expect(custom).toContain('<td>ZZ</td><td class="amount">$3.00</td>');
  });

  it('información adicional: una fila por campo guardado', () => {
    const html = renderRideHtml({
      invoice: invoice({ additionalInfo: { Email: 'juan@x.com', Teléfono: '0999' } }),
      issuer: ISSUER_RECORD,
    });
    expect(html).toContain('<tr><td class="label">Email</td><td>juan@x.com</td></tr>');
    expect(html).toContain('<tr><td class="label">Teléfono</td><td>0999</td></tr>');
  });

  it('sin autorización muestra la clave de acceso y fecha vacía; sin info adicional no hay filas', () => {
    const html = renderRideHtml({
      invoice: invoice({
        authorizationNumber: undefined,
        authorizationDate: undefined,
        buyer: { idType: '05', id: '1', name: 'X' },
      }),
      issuer: {
        ...ISSUER_RECORD,
        issuer: {
          ...ISSUER,
          tradeName: ISSUER.businessName,
          establishmentAddress: undefined,
          specialTaxpayer: '123',
          keepsAccounting: true,
        },
      },
    });
    expect(html).toContain(`<div class="key">${KEY}</div>`);
    expect(html).toContain('FECHA Y HORA DE AUTORIZACIÓN:</strong> </div>');
    expect(html).not.toContain('<td class="label">Email</td>');
    expect(html).not.toContain('<td class="label">Teléfono</td>');
    expect(html).not.toContain('Dirección Sucursal');
    expect(html).toContain('Contribuyente Especial Nro:</strong> 123');
    expect(html).toContain('OBLIGADO A LLEVAR CONTABILIDAD:</strong> SI');
  });
});
