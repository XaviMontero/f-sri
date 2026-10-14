import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import {
  CreditNoteXmlRenderer,
  NOTA_CREDITO_SCHEMA_VERSION,
} from '../../../../src/modules/creditNote/infrastructure/CreditNoteXmlRenderer';
import { ISSUER } from '../../../helpers/fakes';
import { ncLine, numberedCreditNote } from './support';

const renderer = new CreditNoteXmlRenderer();

function parse(xml: string): Element {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level: string, msg: string) => {
      if (level !== 'warning') errors.push(msg);
    },
  } as never).parseFromString(xml, 'text/xml');
  expect(errors).toEqual([]);
  return doc.documentElement as unknown as Element;
}

function children(el: Element, name?: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && (!name || (c as Element).nodeName === name)) out.push(c as Element);
  }
  return out;
}
const names = (el: Element) => children(el).map((c) => c.nodeName);
function child(el: Element, name: string): Element {
  const found = children(el, name)[0];
  if (!found) throw new Error(`sin <${name}> en <${el.nodeName}>`);
  return found;
}
const textOf = (el: Element, name: string) => child(el, name).textContent;

describe('CreditNoteXmlRenderer', () => {
  it('raíz <notaCredito id="comprobante" version="1.1.0"> y orden de secciones', () => {
    const xml = renderer.render(numberedCreditNote({ additionalInfo: { Email: 'a@b.com' } }));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const root = parse(xml);
    expect(root.nodeName).toBe('notaCredito');
    expect(root.getAttribute('id')).toBe('comprobante');
    expect(root.getAttribute('version')).toBe(NOTA_CREDITO_SCHEMA_VERSION);
    expect(NOTA_CREDITO_SCHEMA_VERSION).toBe('1.1.0');
    expect(names(root)).toEqual(['infoTributaria', 'infoNotaCredito', 'detalles', 'infoAdicional']);
  });

  it('infoTributaria con codDoc 04 y la clave de acceso del agregado', () => {
    const nc = numberedCreditNote();
    const it = child(parse(renderer.render(nc)), 'infoTributaria');
    expect(names(it)).toEqual([
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
    expect(textOf(it, 'codDoc')).toBe('04');
    expect(textOf(it, 'claveAcceso')).toBe(nc.accessKey.value);
    expect(textOf(it, 'secuencial')).toBe('000000007');
  });

  it('infoNotaCredito en el orden del XSD (como el XML autorizado del generador original)', () => {
    const info = child(parse(renderer.render(numberedCreditNote())), 'infoNotaCredito');
    expect(names(info)).toEqual([
      'fechaEmision',
      'dirEstablecimiento',
      'tipoIdentificacionComprador',
      'razonSocialComprador',
      'identificacionComprador',
      'obligadoContabilidad',
      'codDocModificado',
      'numDocModificado',
      'fechaEmisionDocSustento',
      'totalSinImpuestos',
      'valorModificacion',
      'moneda',
      'totalConImpuestos',
      'motivo',
    ]);
    expect(textOf(info, 'fechaEmision')).toBe('13/10/2026');
    expect(textOf(info, 'tipoIdentificacionComprador')).toBe('05');
    expect(textOf(info, 'identificacionComprador')).toBe('0106079783');
    expect(textOf(info, 'obligadoContabilidad')).toBe('NO');
    expect(textOf(info, 'codDocModificado')).toBe('01');
    expect(textOf(info, 'numDocModificado')).toBe('001-009-000000001');
    expect(textOf(info, 'fechaEmisionDocSustento')).toBe('13/10/2026');
    expect(textOf(info, 'totalSinImpuestos')).toBe('10.00');
    expect(textOf(info, 'valorModificacion')).toBe('11.50');
    expect(textOf(info, 'moneda')).toBe('DOLAR');
    expect(textOf(info, 'motivo')).toBe('DEVOLUCION DE PRUEBA');
  });

  it('contribuyenteEspecial va entre identificacionComprador y obligadoContabilidad; opcionales vacíos se omiten', () => {
    const special = numberedCreditNote({
      issuer: { ...ISSUER, specialTaxpayer: '12345', establishmentAddress: undefined, keepsAccounting: true },
    });
    const info = child(parse(renderer.render(special)), 'infoNotaCredito');
    const n = names(info);
    expect(n).not.toContain('dirEstablecimiento');
    expect(n.slice(3, 6)).toEqual(['identificacionComprador', 'contribuyenteEspecial', 'obligadoContabilidad']);
    expect(textOf(info, 'obligadoContabilidad')).toBe('SI');
  });

  it('totalConImpuestos agrupa por (codigo, codigoPorcentaje) con tarifas mixtas', () => {
    const nc = numberedCreditNote({
      lines: [
        ncLine({ code: 'A', quantity: 2, unitPrice: 10, ivaCode: '4' }),
        ncLine({ code: 'B', unitPrice: 5.5, ivaCode: '0' }),
        ncLine({ code: 'C', unitPrice: 4, ivaCode: '4' }),
      ],
    });
    const info = child(parse(renderer.render(nc)), 'infoNotaCredito');
    const totals = children(child(info, 'totalConImpuestos'), 'totalImpuesto');
    expect(totals).toHaveLength(2);
    expect(totals.map((t) => names(t))).toEqual([
      ['codigo', 'codigoPorcentaje', 'baseImponible', 'valor'],
      ['codigo', 'codigoPorcentaje', 'baseImponible', 'valor'],
    ]);
    expect(
      totals.map((t) => [
        textOf(t, 'codigo'),
        textOf(t, 'codigoPorcentaje'),
        textOf(t, 'baseImponible'),
        textOf(t, 'valor'),
      ]),
    ).toEqual([
      ['2', '0', '5.50', '0.00'],
      ['2', '4', '24.00', '3.60'],
    ]);
    expect(textOf(info, 'totalSinImpuestos')).toBe('29.50');
    expect(textOf(info, 'valorModificacion')).toBe('33.10');
  });

  it('detalle con codigoInterno/codigoAdicional y orden del XSD', () => {
    const nc = numberedCreditNote({
      lines: [ncLine({ auxiliaryCode: 'AUX-1', quantity: 1.5, unitPrice: 2.123456, discount: 0.18 })],
    });
    const detalle = child(child(parse(renderer.render(nc)), 'detalles'), 'detalle');
    expect(names(detalle)).toEqual([
      'codigoInterno',
      'codigoAdicional',
      'descripcion',
      'cantidad',
      'precioUnitario',
      'descuento',
      'precioTotalSinImpuesto',
      'impuestos',
    ]);
    expect(textOf(detalle, 'codigoInterno')).toBe('PRD001');
    expect(textOf(detalle, 'codigoAdicional')).toBe('AUX-1');
    expect(textOf(detalle, 'cantidad')).toBe('1.50');
    expect(textOf(detalle, 'precioUnitario')).toBe('2.123456');
    expect(textOf(detalle, 'descuento')).toBe('0.18');
    // 1.5 × 2.123456 = 3.185184 → 3.19 − 0.18 = 3.01
    expect(textOf(detalle, 'precioTotalSinImpuesto')).toBe('3.01');
    const impuesto = child(child(detalle, 'impuestos'), 'impuesto');
    expect(names(impuesto)).toEqual(['codigo', 'codigoPorcentaje', 'tarifa', 'baseImponible', 'valor']);
    expect(textOf(impuesto, 'tarifa')).toBe('15.00');
    expect(textOf(impuesto, 'baseImponible')).toBe('3.01');
    expect(textOf(impuesto, 'valor')).toBe('0.45');
  });

  it('sin codigoAdicional no emite el elemento', () => {
    const detalle = child(child(parse(renderer.render(numberedCreditNote())), 'detalles'), 'detalle');
    expect(names(detalle)).not.toContain('codigoAdicional');
  });

  it('escapa caracteres especiales en datos del cliente', () => {
    const nc = numberedCreditNote({
      reason: 'DEVOLUCIÓN <parcial> & "otros"',
      buyer: { idType: '05', id: '0106079783', name: 'PÉREZ & HIJOS <S.A.>' },
      lines: [ncLine({ description: 'Café <premium> & más' })],
      additionalInfo: { 'Nota & más': '<b>x</b>' },
    });
    const xml = renderer.render(nc);
    expect(xml).not.toContain('<parcial>');
    expect(xml).not.toContain('<premium>');
    const root = parse(xml);
    const info = child(root, 'infoNotaCredito');
    expect(textOf(info, 'motivo')).toBe('DEVOLUCIÓN <parcial> & "otros"');
    expect(textOf(info, 'razonSocialComprador')).toBe('PÉREZ & HIJOS <S.A.>');
    expect(textOf(child(child(root, 'detalles'), 'detalle'), 'descripcion')).toBe('Café <premium> & más');
    const campo = child(child(root, 'infoAdicional'), 'campoAdicional');
    expect(campo.getAttribute('nombre')).toBe('Nota & más');
    expect(campo.textContent).toBe('<b>x</b>');
  });

  it('sin info adicional no emite <infoAdicional>', () => {
    expect(names(parse(renderer.render(numberedCreditNote())))).toEqual([
      'infoTributaria',
      'infoNotaCredito',
      'detalles',
    ]);
  });
});
