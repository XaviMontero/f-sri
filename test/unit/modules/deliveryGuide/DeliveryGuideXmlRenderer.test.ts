import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { DeliveryGuideXmlRenderer } from '../../../../src/modules/deliveryGuide/infrastructure/DeliveryGuideXmlRenderer';
import { ISSUER } from '../../../helpers/fakes';
import { AUTH_49, numberedGuide, recipient } from './builders';

const render = (...args: Parameters<typeof numberedGuide>) =>
  new DeliveryGuideXmlRenderer().render(numberedGuide(...args));

function parse(xml: string) {
  return new DOMParser().parseFromString(xml, 'text/xml');
}

function childNames(node: Element): string[] {
  return Array.from(node.childNodes)
    .filter((n) => n.nodeType === 1)
    .map((n) => (n as Element).tagName);
}

function child(node: Element, name: string): Element {
  const found = Array.from(node.childNodes).find((n) => n.nodeType === 1 && (n as Element).tagName === name);
  if (!found) throw new Error(`no <${name}>`);
  return found as Element;
}

const textOf = (node: Element, name: string) => child(node, name).textContent;

describe('DeliveryGuideXmlRenderer', () => {
  it('raíz guiaRemision 1.1.0 con id comprobante y bloques en orden', () => {
    const root = parse(render()).documentElement!;
    expect(root.tagName).toBe('guiaRemision');
    expect(root.getAttribute('id')).toBe('comprobante');
    expect(root.getAttribute('version')).toBe('1.1.0');
    expect(childNames(root)).toEqual(['infoTributaria', 'infoGuiaRemision', 'destinatarios']);
  });

  it('infoTributaria con codDoc 06, secuencial y clave', () => {
    const info = child(parse(render()).documentElement!, 'infoTributaria');
    expect(textOf(info, 'codDoc')).toBe('06');
    expect(textOf(info, 'secuencial')).toBe('000000007');
    expect(textOf(info, 'claveAcceso')).toBe('1310202606010607978300110010010000000071234567813');
    expect(textOf(info, 'ptoEmi')).toBe('001');
  });

  it('infoGuiaRemision en el orden del generador original (sin fechaEmision)', () => {
    const info = child(parse(render()).documentElement!, 'infoGuiaRemision');
    expect(childNames(info)).toEqual([
      'dirEstablecimiento',
      'dirPartida',
      'razonSocialTransportista',
      'tipoIdentificacionTransportista',
      'rucTransportista',
      'obligadoContabilidad',
      'fechaIniTransporte',
      'fechaFinTransporte',
      'placa',
    ]);
    expect(textOf(info, 'obligadoContabilidad')).toBe('NO');
    expect(textOf(info, 'fechaIniTransporte')).toBe('13/10/2026');
    expect(textOf(info, 'fechaFinTransporte')).toBe('14/10/2026');
    expect(textOf(info, 'placa')).toBe('ABC1234');
  });

  it('incluye contribuyenteEspecial tras obligadoContabilidad y usa dirMatriz si no hay dirEstablecimiento', () => {
    const issuer = { ...ISSUER, establishmentAddress: undefined, keepsAccounting: true, specialTaxpayer: '5368' };
    const info = child(parse(render({ issuer })).documentElement!, 'infoGuiaRemision');
    const names = childNames(info);
    expect(names.indexOf('contribuyenteEspecial')).toBe(names.indexOf('obligadoContabilidad') + 1);
    expect(textOf(info, 'contribuyenteEspecial')).toBe('5368');
    expect(textOf(info, 'obligadoContabilidad')).toBe('SI');
    expect(textOf(info, 'dirEstablecimiento')).toBe(ISSUER.headOfficeAddress);
  });

  it('destinatario con todos los opcionales en orden y detalles al final', () => {
    const full = recipient({ customsDocument: 'DAU-1', destinationEstablishment: '002' });
    const dest = child(child(parse(render({ recipients: [full] })).documentElement!, 'destinatarios'), 'destinatario');
    expect(childNames(dest)).toEqual([
      'identificacionDestinatario',
      'razonSocialDestinatario',
      'dirDestinatario',
      'motivoTraslado',
      'docAduaneroUnico',
      'codEstabDestino',
      'ruta',
      'codDocSustento',
      'numDocSustento',
      'numAutDocSustento',
      'fechaEmisionDocSustento',
      'detalles',
    ]);
    expect(textOf(dest, 'numAutDocSustento')).toBe(AUTH_49);
    const detalle = child(child(dest, 'detalles'), 'detalle');
    expect(childNames(detalle)).toEqual(['codigoInterno', 'descripcion', 'cantidad']);
  });

  it('omite opcionales vacíos del destinatario y del detalle', () => {
    const minimal = recipient({
      route: undefined,
      supportingDocument: undefined,
      items: [{ description: 'Caja', quantity: 2 }],
    });
    const dest = child(
      child(parse(render({ recipients: [minimal] })).documentElement!, 'destinatarios'),
      'destinatario',
    );
    expect(childNames(dest)).toEqual([
      'identificacionDestinatario',
      'razonSocialDestinatario',
      'dirDestinatario',
      'motivoTraslado',
      'detalles',
    ]);
    expect(childNames(child(child(dest, 'detalles'), 'detalle'))).toEqual(['descripcion', 'cantidad']);
  });

  it('codigoAdicional va entre codigoInterno y descripcion', () => {
    const r = recipient({ items: [{ internalCode: 'A', additionalCode: 'B', description: 'C', quantity: 1 }] });
    const dest = child(child(parse(render({ recipients: [r] })).documentElement!, 'destinatarios'), 'destinatario');
    expect(childNames(child(child(dest, 'detalles'), 'detalle'))).toEqual([
      'codigoInterno',
      'codigoAdicional',
      'descripcion',
      'cantidad',
    ]);
  });

  it('cantidades con hasta 6 decimales', () => {
    const r = recipient({
      items: [
        { description: 'a', quantity: 1 },
        { description: 'b', quantity: 0.123456 },
        { description: 'c', quantity: 2.5 },
      ],
    });
    const xml = render({ recipients: [r] });
    const quantities = Array.from(parse(xml).getElementsByTagName('cantidad')).map((n) => n.textContent);
    expect(quantities).toEqual(['1.00', '0.123456', '2.50']);
  });

  it('varios destinatarios, cada uno con sus detalles', () => {
    const xml = render({ recipients: [recipient(), recipient({ id: '1790000000001', name: 'OTRO' })] });
    const doc = parse(xml);
    expect(doc.getElementsByTagName('destinatario')).toHaveLength(2);
    expect(doc.getElementsByTagName('detalle')).toHaveLength(2);
  });

  it('escapa caracteres especiales', () => {
    const r = recipient({ name: 'A & B <S.A.>', items: [{ description: 'Tornillos "3/4" & tuercas', quantity: 1 }] });
    const xml = render({ recipients: [r], departureAddress: 'Av. <1> & 2' });
    expect(xml).toContain('A &amp; B &lt;S.A.&gt;');
    expect(xml).not.toContain('<S.A.>');
    const doc = parse(xml);
    expect(doc.getElementsByTagName('dirPartida')[0].textContent).toBe('Av. <1> & 2');
    expect(doc.getElementsByTagName('descripcion')[0].textContent).toBe('Tornillos "3/4" & tuercas');
  });

  it('agrega infoAdicional al final cuando hay campos', () => {
    const root = parse(render({ additionalInfo: { Email: 'a@b.ec' } })).documentElement!;
    expect(childNames(root)).toEqual(['infoTributaria', 'infoGuiaRemision', 'destinatarios', 'infoAdicional']);
    expect(root.getElementsByTagName('campoAdicional')[0].getAttribute('nombre')).toBe('Email');
  });
});
