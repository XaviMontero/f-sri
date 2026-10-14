import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import {
  RETENCION_SCHEMA_VERSION,
  WithholdingXmlRenderer,
  formatPercentage,
} from '../../../../src/modules/withholding/infrastructure/WithholdingXmlRenderer';
import { ISSUER } from '../../../helpers/fakes';
import { buildWithholding, supportDoc } from './fixtures';

const renderer = new WithholdingXmlRenderer();
const KEYS = { accessKey: '1310202607010607978300110010140000000011234567818', sequential: '000000001' };

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

describe('WithholdingXmlRenderer (comprobanteRetencion 2.0.0)', () => {
  it('raíz <comprobanteRetencion id="comprobante" version="2.0.0"> y orden de secciones', () => {
    const xml = renderer.render(buildWithholding(), KEYS);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const root = parse(xml);
    expect(root.nodeName).toBe('comprobanteRetencion');
    expect(root.getAttribute('id')).toBe('comprobante');
    expect(root.getAttribute('version')).toBe(RETENCION_SCHEMA_VERSION);
    expect(childNames(root)).toEqual(['infoTributaria', 'infoCompRetencion', 'docsSustento']);
  });

  it('infoTributaria con codDoc 07, clave y secuencial reservados', () => {
    const info = child(parse(renderer.render(buildWithholding(), KEYS)), 'infoTributaria');
    expect(textOf(info, 'codDoc')).toBe('07');
    expect(textOf(info, 'claveAcceso')).toBe(KEYS.accessKey);
    expect(textOf(info, 'secuencial')).toBe('000000001');
    expect(textOf(info, 'ruc')).toBe(ISSUER.ruc);
  });

  it('infoCompRetencion en el orden del XSD, con parteRel siempre presente', () => {
    const info = child(parse(renderer.render(buildWithholding(), KEYS)), 'infoCompRetencion');
    expect(childNames(info)).toEqual([
      'fechaEmision',
      'dirEstablecimiento',
      'obligadoContabilidad',
      'tipoIdentificacionSujetoRetenido',
      'parteRel',
      'razonSocialSujetoRetenido',
      'identificacionSujetoRetenido',
      'periodoFiscal',
    ]);
    expect(textOf(info, 'fechaEmision')).toBe('13/10/2026');
    expect(textOf(info, 'obligadoContabilidad')).toBe('NO');
    expect(textOf(info, 'parteRel')).toBe('NO');
    expect(textOf(info, 'periodoFiscal')).toBe('10/2026');
  });

  it('parteRel = NO aunque el cliente no lo envíe; opcionales contribuyenteEspecial y tipoSujetoRetenido en su lugar', () => {
    const w = buildWithholding({
      issuer: { ...ISSUER, specialTaxpayer: '5368', keepsAccounting: true },
      subject: { idType: '08', id: 'EXT-1', name: 'FOREIGN LLC', subjectType: '02' },
    });
    const info = child(parse(renderer.render(w, KEYS)), 'infoCompRetencion');
    expect(childNames(info)).toEqual([
      'fechaEmision',
      'dirEstablecimiento',
      'contribuyenteEspecial',
      'obligadoContabilidad',
      'tipoIdentificacionSujetoRetenido',
      'tipoSujetoRetenido',
      'parteRel',
      'razonSocialSujetoRetenido',
      'identificacionSujetoRetenido',
      'periodoFiscal',
    ]);
    expect(textOf(info, 'parteRel')).toBe('NO');
    expect(textOf(info, 'tipoSujetoRetenido')).toBe('02');
    expect(textOf(info, 'obligadoContabilidad')).toBe('SI');
  });

  it('docSustento: orden, importes con 2 decimales, porcentajes sin relleno y <formaPago> camelCase', () => {
    const xml = renderer.render(buildWithholding(), KEYS);
    expect(xml).toContain('<formaPago>01</formaPago>');
    expect(xml).not.toContain('<formapago>');
    const docs = child(parse(xml), 'docsSustento');
    expect(childNames(docs)).toEqual(['docSustento']);
    const doc = child(docs, 'docSustento');
    expect(childNames(doc)).toEqual([
      'codSustento',
      'codDocSustento',
      'numDocSustento',
      'fechaEmisionDocSustento',
      'numAutDocSustento',
      'pagoLocExt',
      'totalSinImpuestos',
      'importeTotal',
      'impuestosDocSustento',
      'retenciones',
      'pagos',
    ]);
    expect(textOf(doc, 'totalSinImpuestos')).toBe('10.00');
    expect(textOf(doc, 'importeTotal')).toBe('11.50');

    const tax = child(child(doc, 'impuestosDocSustento'), 'impuestoDocSustento');
    expect(childNames(tax)).toEqual([
      'codImpuestoDocSustento',
      'codigoPorcentaje',
      'baseImponible',
      'tarifa',
      'valorImpuesto',
    ]);
    expect([textOf(tax, 'tarifa'), textOf(tax, 'valorImpuesto')]).toEqual(['15', '1.50']);

    const ret = child(child(doc, 'retenciones'), 'retencion');
    expect(childNames(ret)).toEqual([
      'codigo',
      'codigoRetencion',
      'baseImponible',
      'porcentajeRetener',
      'valorRetenido',
    ]);
    expect(
      ['codigo', 'codigoRetencion', 'baseImponible', 'porcentajeRetener', 'valorRetenido'].map((n) => textOf(ret, n)),
    ).toEqual(['1', '303', '10.00', '10', '1.00']);

    const pago = child(child(doc, 'pagos'), 'pago');
    expect(childNames(pago)).toEqual(['formaPago', 'total']);
    expect(textOf(pago, 'total')).toBe('11.50');
  });

  it('fechaRegistroContable va entre fechaEmisionDocSustento y numAutDocSustento; omite opcionales vacíos', () => {
    const w = buildWithholding({
      supportDocuments: [
        supportDoc({ accountingDate: '13/10/2026', number: undefined, authorizationNumber: undefined }),
      ],
    });
    const doc = child(child(parse(renderer.render(w, KEYS)), 'docsSustento'), 'docSustento');
    expect(childNames(doc).slice(0, 5)).toEqual([
      'codSustento',
      'codDocSustento',
      'fechaEmisionDocSustento',
      'fechaRegistroContable',
      'pagoLocExt',
    ]);
  });

  it('varios documentos, retenciones y pagos; el valorRetenido es el calculado', () => {
    const w = buildWithholding({
      supportDocuments: [
        supportDoc(),
        supportDoc({
          number: '001009000000002',
          subtotal: 100,
          total: 115,
          taxes: [{ taxCode: '2', rateCode: '4', base: 100 }],
          retentions: [
            { taxCode: '1', retentionCode: '312', base: 100, percentage: 1.75 },
            { taxCode: '2', retentionCode: '725', base: 15, percentage: 30 },
          ],
          payments: [
            { method: '01', amount: 100 },
            { method: '20', amount: 15 },
          ],
        }),
      ],
    });
    const xml = renderer.render(w, KEYS);
    const docs = child(parse(xml), 'docsSustento');
    expect(childNames(docs)).toEqual(['docSustento', 'docSustento']);
    expect(xml).toContain('<porcentajeRetener>1.75</porcentajeRetener><valorRetenido>1.75</valorRetenido>');
    expect(xml).toContain('<porcentajeRetener>30</porcentajeRetener><valorRetenido>4.50</valorRetenido>');
    expect(xml.match(/<pago>/g)).toHaveLength(3);
  });

  it('escapa caracteres especiales del cliente y agrega infoAdicional al final', () => {
    const w = buildWithholding({
      subject: { idType: '05', id: '0106079783', name: 'A & B <S.A.> "x"' },
      additionalInfo: { Nota: 'uno & dos', Vacío: '  ' },
    });
    const xml = renderer.render(w, KEYS);
    expect(xml).toContain('A &amp; B &lt;S.A.&gt;');
    const root = parse(xml);
    expect(textOf(child(root, 'infoCompRetencion'), 'razonSocialSujetoRetenido')).toBe('A & B <S.A.> "x"');
    expect(childNames(root)).toEqual(['infoTributaria', 'infoCompRetencion', 'docsSustento', 'infoAdicional']);
    expect(childNames(child(root, 'infoAdicional'))).toEqual(['campoAdicional']);
  });

  it('formatPercentage', () => {
    expect([15, 10, 1.75, 2.5, 0, 12.0].map(formatPercentage)).toEqual(['15', '10', '1.75', '2.5', '0', '12']);
  });
});
