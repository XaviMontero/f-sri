import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import {
  DebitNoteXmlRenderer,
  NOTA_DEBITO_SCHEMA_VERSION,
} from '../../../../src/modules/debitNote/infrastructure/DebitNoteXmlRenderer';
import { ISSUER } from '../../../helpers/fakes';
import { buildDebitNote } from './support';

const renderer = new DebitNoteXmlRenderer();
const NUMBERING = { accessKey: '1310202605010607978300110010120000000011234567811', sequential: '000000001' };

function parse(xml: string) {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level: string, msg: string) => {
      if (level !== 'warning') errors.push(msg);
    },
  } as never).parseFromString(xml, 'text/xml');
  expect(errors).toEqual([]);
  return doc.documentElement as unknown as Element;
}

function children(el: Element): Element[] {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
  return out;
}
const names = (el: Element) => children(el).map((c) => c.nodeName);
const child = (el: Element, name: string) => {
  const found = children(el).find((c) => c.nodeName === name);
  if (!found) throw new Error(`sin <${name}> en <${el.nodeName}>`);
  return found;
};
const textOf = (el: Element, name: string) => child(el, name).textContent;

describe('DebitNoteXmlRenderer', () => {
  it('raíz <notaDebito id="comprobante" version="1.0.0"> y orden de secciones (sin detalles)', () => {
    const xml = renderer.render(buildDebitNote({ additionalInfo: { Email: 'a@b.ec' } }), NUMBERING);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const root = parse(xml);
    expect(root.nodeName).toBe('notaDebito');
    expect(root.getAttribute('id')).toBe('comprobante');
    expect(root.getAttribute('version')).toBe(NOTA_DEBITO_SCHEMA_VERSION);
    expect(names(root)).toEqual(['infoTributaria', 'infoNotaDebito', 'motivos', 'infoAdicional']);
  });

  it('infoTributaria con codDoc 05, secuencial y clave asignados', () => {
    const it = child(parse(renderer.render(buildDebitNote(), NUMBERING)), 'infoTributaria');
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
    expect(textOf(it, 'codDoc')).toBe('05');
    expect(textOf(it, 'claveAcceso')).toBe(NUMBERING.accessKey);
    expect(textOf(it, 'secuencial')).toBe('000000001');
  });

  it('infoNotaDebito en el orden del generador autorizado por el SRI', () => {
    const info = child(parse(renderer.render(buildDebitNote(), NUMBERING)), 'infoNotaDebito');
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
      'impuestos',
      'valorTotal',
      'pagos',
    ]);
    expect(textOf(info, 'fechaEmision')).toBe('13/10/2026');
    expect(textOf(info, 'obligadoContabilidad')).toBe('NO');
    expect(textOf(info, 'codDocModificado')).toBe('01');
    expect(textOf(info, 'numDocModificado')).toBe('001-009-000000001');
    expect(textOf(info, 'fechaEmisionDocSustento')).toBe('13/10/2026');
    expect(textOf(info, 'totalSinImpuestos')).toBe('2.00');
    expect(textOf(info, 'valorTotal')).toBe('2.30');
    const tax = child(child(info, 'impuestos'), 'impuesto');
    expect(names(tax)).toEqual(['codigo', 'codigoPorcentaje', 'tarifa', 'baseImponible', 'valor']);
    expect(children(tax).map((c) => c.textContent)).toEqual(['2', '4', '15.00', '2.00', '0.30']);
    const pago = child(child(info, 'pagos'), 'pago');
    expect(names(pago)).toEqual(['formaPago', 'total']);
    expect(textOf(pago, 'total')).toBe('2.30');
  });

  it('contribuyenteEspecial (XSD) tras identificacionComprador; sin dirEstablecimiento si no hay', () => {
    const info = child(
      parse(
        renderer.render(
          buildDebitNote({
            issuer: { ...ISSUER, specialTaxpayer: '12345', establishmentAddress: undefined, keepsAccounting: true },
          }),
          NUMBERING,
        ),
      ),
      'infoNotaDebito',
    );
    expect(names(info).slice(0, 6)).toEqual([
      'fechaEmision',
      'tipoIdentificacionComprador',
      'razonSocialComprador',
      'identificacionComprador',
      'contribuyenteEspecial',
      'obligadoContabilidad',
    ]);
    expect(textOf(info, 'obligadoContabilidad')).toBe('SI');
  });

  it('pagos con plazo 0 y unidadTiempo; varias tarifas; motivos en orden', () => {
    const nd = buildDebitNote({
      reasons: [
        { reason: 'Mora', value: 10, ivaCode: '4' },
        { reason: 'Exento', value: 5, ivaCode: '0' },
      ],
      payments: [
        { method: '01', amount: 10, term: 0, timeUnit: 'dias' },
        { method: '19', amount: 6.5 },
      ],
    });
    const root = parse(renderer.render(nd, NUMBERING));
    const info = child(root, 'infoNotaDebito');
    const pagos = children(child(info, 'pagos'));
    expect(names(pagos[0])).toEqual(['formaPago', 'total', 'plazo', 'unidadTiempo']);
    expect(textOf(pagos[0], 'plazo')).toBe('0');
    expect(textOf(pagos[0], 'unidadTiempo')).toBe('dias');
    expect(children(child(info, 'impuestos')).map((t) => textOf(t, 'codigoPorcentaje'))).toEqual(['4', '0']);
    const motivos = children(child(root, 'motivos'));
    expect(motivos.map((m) => names(m))).toEqual([
      ['razon', 'valor'],
      ['razon', 'valor'],
    ]);
    expect(motivos.map((m) => `${textOf(m, 'razon')}=${textOf(m, 'valor')}`)).toEqual(['Mora=10.00', 'Exento=5.00']);
  });

  it('escapa caracteres especiales y omite infoAdicional vacía', () => {
    const xml = renderer.render(
      buildDebitNote({
        buyer: { idType: '05', id: '0106079783', name: 'PÉREZ & HIJOS <S.A.>' },
        reasons: [{ reason: 'Mora "30" días & <gastos>', value: 1 }],
      }),
      NUMBERING,
    );
    expect(xml).toContain('PÉREZ &amp; HIJOS &lt;S.A.&gt;');
    const root = parse(xml);
    expect(textOf(child(child(root, 'motivos'), 'motivo'), 'razon')).toBe('Mora "30" días & <gastos>');
    expect(names(root)).not.toContain('infoAdicional');
  });
});
