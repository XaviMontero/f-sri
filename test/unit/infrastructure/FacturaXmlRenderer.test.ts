import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { FACTURA_SCHEMA_VERSION, FacturaXmlRenderer } from '../../../src/infrastructure/sri/FacturaXmlRenderer';
import { ISSUER } from '../../helpers/fakes';
import { buildInvoice, line } from '../support/builders';

const renderer = new FacturaXmlRenderer();

function parse(xml: string) {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level: string, msg: string) => {
      if (level !== 'warning') errors.push(msg);
    },
  } as never).parseFromString(xml, 'text/xml');
  expect(errors).toEqual([]);
  return doc;
}

function childNames(el: Element): string[] {
  const names: string[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) names.push((c as Element).nodeName);
  return names;
}

function child(el: Element, name: string): Element {
  for (let c = el.firstChild; c; c = c.nextSibling)
    if (c.nodeType === 1 && (c as Element).nodeName === name) return c as Element;
  throw new Error(`sin <${name}> en <${el.nodeName}>`);
}

const textOf = (el: Element, name: string) => child(el, name).textContent;

describe('FacturaXmlRenderer', () => {
  it('raíz <factura id="comprobante" version="1.1.0"> con declaración UTF-8 y orden de secciones', () => {
    const xml = renderer.render(buildInvoice({ additionalInfo: { Email: 'a@b.com' } }));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const root = parse(xml).documentElement as unknown as Element;
    expect(root.nodeName).toBe('factura');
    expect(root.getAttribute('id')).toBe('comprobante');
    expect(root.getAttribute('version')).toBe(FACTURA_SCHEMA_VERSION);
    expect(FACTURA_SCHEMA_VERSION).toBe('1.1.0');
    expect(childNames(root)).toEqual(['infoTributaria', 'infoFactura', 'detalles', 'infoAdicional']);
  });

  it('infoTributaria en el orden del XSD', () => {
    const inv = buildInvoice();
    const root = parse(renderer.render(inv)).documentElement as unknown as Element;
    const it = child(root, 'infoTributaria');
    expect(childNames(it)).toEqual([
      'ambiente',
      'tipoEmision',
      'razonSocial',
      'nombreComercial',
      'ruc',
      'claveAcceso',
      'codDoc',
      'estab',
      'ptoEmi',
      'secuencial',
      'dirMatriz',
    ]);
    expect(textOf(it, 'ambiente')).toBe('1');
    expect(textOf(it, 'claveAcceso')).toBe(inv.accessKey.value);
    expect(textOf(it, 'codDoc')).toBe('01');
    expect(textOf(it, 'secuencial')).toBe('000000123');
  });

  it('infoFactura completa en el orden del XSD', () => {
    const inv = buildInvoice({
      issuer: { ...ISSUER, specialTaxpayer: '5368', keepsAccounting: true },
      buyer: { idType: '05', id: '0102030405', name: 'JUAN', address: 'Av. Loja' },
      payments: [{ method: '19', amount: 11.5, term: 30, timeUnit: 'dias' }],
    });
    const root = parse(renderer.render(inv)).documentElement as unknown as Element;
    const info = child(root, 'infoFactura');
    expect(childNames(info)).toEqual([
      'fechaEmision',
      'dirEstablecimiento',
      'contribuyenteEspecial',
      'obligadoContabilidad',
      'tipoIdentificacionComprador',
      'razonSocialComprador',
      'identificacionComprador',
      'direccionComprador',
      'totalSinImpuestos',
      'totalDescuento',
      'totalConImpuestos',
      'propina',
      'importeTotal',
      'moneda',
      'pagos',
    ]);
    expect(textOf(info, 'fechaEmision')).toBe('13/10/2026');
    expect(textOf(info, 'obligadoContabilidad')).toBe('SI');
    expect(textOf(info, 'contribuyenteEspecial')).toBe('5368');
    expect(textOf(info, 'moneda')).toBe('DOLAR');
    const pago = child(child(info, 'pagos'), 'pago');
    expect(childNames(pago)).toEqual(['formaPago', 'total', 'plazo', 'unidadTiempo']);
    expect(textOf(pago, 'plazo')).toBe('30');
    expect(textOf(pago, 'unidadTiempo')).toBe('dias');
  });

  it('omite opcionales vacíos', () => {
    const inv = buildInvoice({
      issuer: { ...ISSUER, tradeName: '  ', establishmentAddress: undefined, keepsAccounting: false },
      buyer: { idType: '05', id: '0102030405', name: 'JUAN', address: '' },
    });
    const xml = renderer.render(inv);
    const root = parse(xml).documentElement as unknown as Element;
    expect(childNames(child(root, 'infoTributaria'))).not.toContain('nombreComercial');
    const info = child(root, 'infoFactura');
    for (const name of ['dirEstablecimiento', 'contribuyenteEspecial', 'direccionComprador']) {
      expect(childNames(info)).not.toContain(name);
    }
    expect(textOf(info, 'obligadoContabilidad')).toBe('NO');
    expect(childNames(child(child(info, 'pagos'), 'pago'))).toEqual(['formaPago', 'total']);
    expect(childNames(root)).not.toContain('infoAdicional');
    expect(xml).not.toContain('codigoAuxiliar');
  });

  it('escapa & y < en textos y atributos', () => {
    const inv = buildInvoice({
      buyer: { idType: '05', id: '0102030405', name: 'PEREZ & HIJOS <S.A.>' },
      lines: [line({ description: 'Tornillo <1/2"> & tuerca' })],
      additionalInfo: { 'Nota & <obs>': 'a < b & c' },
    });
    const xml = renderer.render(inv);
    expect(xml).toContain('PEREZ &amp; HIJOS &lt;S.A.&gt;');
    expect(xml).not.toContain('PEREZ & HIJOS');
    const root = parse(xml).documentElement as unknown as Element;
    expect(textOf(child(root, 'infoFactura'), 'razonSocialComprador')).toBe('PEREZ & HIJOS <S.A.>');
    expect(textOf(child(child(root, 'detalles'), 'detalle'), 'descripcion')).toBe('Tornillo <1/2"> & tuerca');
    const campo = child(child(root, 'infoAdicional'), 'campoAdicional');
    expect(campo.getAttribute('nombre')).toBe('Nota & <obs>');
    expect(campo.textContent).toBe('a < b & c');
  });

  it('agrupa totalConImpuestos por tarifa y formatea decimales', () => {
    const inv = buildInvoice({
      lines: [
        line({ code: 'A', quantity: 2, unitPrice: 3.125, discount: 0.25, ivaCode: '4' }),
        line({ code: 'B', quantity: 1.5, unitPrice: 4, ivaCode: '0', auxiliaryCode: 'AUX-B' }),
        line({ code: 'C', quantity: 1, unitPrice: 10, ivaCode: '4' }),
      ],
    });
    const root = parse(renderer.render(inv)).documentElement as unknown as Element;
    const info = child(root, 'infoFactura');
    expect(textOf(info, 'totalSinImpuestos')).toBe('22.00');
    expect(textOf(info, 'totalDescuento')).toBe('0.25');
    expect(textOf(info, 'propina')).toBe('0.00');

    const impuestos = Array.from(child(info, 'totalConImpuestos').getElementsByTagName('totalImpuesto'));
    expect(impuestos.map((t) => childNames(t as unknown as Element))).toEqual([
      ['codigo', 'codigoPorcentaje', 'baseImponible', 'valor'],
      ['codigo', 'codigoPorcentaje', 'baseImponible', 'valor'],
    ]);
    expect(
      impuestos.map((t) =>
        ['codigo', 'codigoPorcentaje', 'baseImponible', 'valor'].map((n) => textOf(t as unknown as Element, n)),
      ),
    ).toEqual([
      ['2', '0', '6.00', '0.00'],
      ['2', '4', '16.00', '2.40'],
    ]);
    expect(textOf(info, 'importeTotal')).toBe('24.40');

    const detalles = Array.from(child(root, 'detalles').getElementsByTagName('detalle')) as unknown as Element[];
    expect(detalles).toHaveLength(3);
    const [a, b] = detalles;
    expect(childNames(a)).toEqual([
      'codigoPrincipal',
      'descripcion',
      'cantidad',
      'precioUnitario',
      'descuento',
      'precioTotalSinImpuesto',
      'impuestos',
    ]);
    expect(childNames(b)).toEqual([
      'codigoPrincipal',
      'codigoAuxiliar',
      'descripcion',
      'cantidad',
      'precioUnitario',
      'descuento',
      'precioTotalSinImpuesto',
      'impuestos',
    ]);
    expect(textOf(a, 'cantidad')).toBe('2.00');
    expect(textOf(a, 'precioUnitario')).toBe('3.125');
    expect(textOf(a, 'descuento')).toBe('0.25');
    expect(textOf(a, 'precioTotalSinImpuesto')).toBe('6.00');
    const imp = child(child(a, 'impuestos'), 'impuesto');
    expect(childNames(imp)).toEqual(['codigo', 'codigoPorcentaje', 'tarifa', 'baseImponible', 'valor']);
    expect(['codigo', 'codigoPorcentaje', 'tarifa', 'baseImponible', 'valor'].map((n) => textOf(imp, n))).toEqual([
      '2',
      '4',
      '15.00',
      '6.00',
      '0.90',
    ]);
    expect(textOf(b, 'cantidad')).toBe('1.50');
    expect(textOf(child(child(b, 'impuestos'), 'impuesto'), 'tarifa')).toBe('0.00');
  });

  it('múltiples pagos en orden', () => {
    const inv = buildInvoice({
      payments: [
        { method: '01', amount: 5 },
        { method: '16', amount: 6.5 },
      ],
    });
    const root = parse(renderer.render(inv)).documentElement as unknown as Element;
    const pagos = Array.from(
      child(child(root, 'infoFactura'), 'pagos').getElementsByTagName('pago'),
    ) as unknown as Element[];
    expect(pagos.map((p) => [textOf(p, 'formaPago'), textOf(p, 'total')])).toEqual([
      ['01', '5.00'],
      ['16', '6.50'],
    ]);
  });

  it('es determinista y no tiene pretty print', () => {
    const inv = buildInvoice();
    const xml = renderer.render(inv);
    expect(renderer.render(inv)).toBe(xml);
    expect(xml).not.toMatch(/>\s+</);
  });
});
