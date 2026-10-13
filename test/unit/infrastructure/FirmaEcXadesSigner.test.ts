import { createHash } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { ExclusiveCanonicalization, SignedXml } from 'xml-crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { FirmaEcXadesSigner } from '../../../src/infrastructure/signing/FirmaEcXadesSigner';
import { FacturaXmlRenderer } from '../../../src/infrastructure/sri/FacturaXmlRenderer';
import { testCertificate } from '../../helpers/certificate';
import { buildInvoice } from '../support/builders';

const DS = 'http://www.w3.org/2000/09/xmldsig#';
const XADES = 'http://uri.etsi.org/01903/v1.3.2#';
const SIGNING_TIME = new Date('2026-10-13T17:00:00Z');

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;

describe('FirmaEcXadesSigner (XAdES-BES con firmaec.js)', () => {
  const cert = testCertificate();
  const xml = new FacturaXmlRenderer().render(
    buildInvoice({ buyer: { idType: '05', id: '0102030405', name: 'PÉREZ & HIJOS ñ' } }),
  );
  let signed: string;
  let doc: Document;

  beforeAll(async () => {
    signed = await new FirmaEcXadesSigner(() => SIGNING_TIME).sign(xml, cert);
    doc = parse(signed);
  });

  it('agrega ds:Signature como último hijo de <factura>', () => {
    const root = doc.documentElement;
    expect(root.nodeName).toBe('factura');
    expect(root.getAttribute('id')).toBe('comprobante');
    const signatures = doc.getElementsByTagNameNS(DS, 'Signature');
    expect(signatures.length).toBe(1);
    expect(root.lastChild).toBe(signatures[0]);
    expect(signed).toContain('<ds:Signature');
  });

  it('contiene xades:SignedProperties con SigningTime igual al reloj inyectado', () => {
    expect(doc.getElementsByTagNameNS(XADES, 'SignedProperties').length).toBe(1);
    const signingTime = doc.getElementsByTagNameNS(XADES, 'SigningTime')[0].textContent!;
    expect(new Date(signingTime).getTime()).toBe(SIGNING_TIME.getTime());
  });

  it('X509Certificate es el certificado del .p12', () => {
    const x509 = doc.getElementsByTagNameNS(DS, 'X509Certificate')[0].textContent!.replace(/\s+/g, '');
    expect(x509).toBe(cert.certificateBase64);
  });

  it('referencia #comprobante con enveloped-signature y SHA-256', () => {
    const refs = Array.from(doc.getElementsByTagNameNS(DS, 'Reference') as unknown as ArrayLike<Element>);
    const comprobante = refs.find((r) => r.getAttribute('URI') === '#comprobante');
    expect(comprobante).toBeDefined();
    const transforms = Array.from(
      comprobante!.getElementsByTagNameNS(DS, 'Transform') as unknown as ArrayLike<Element>,
    ).map((t) => t.getAttribute('Algorithm'));
    expect(transforms).toContain('http://www.w3.org/2000/09/xmldsig#enveloped-signature');
    expect(comprobante!.getElementsByTagNameNS(DS, 'DigestMethod')[0].getAttribute('Algorithm')).toBe(
      'http://www.w3.org/2001/04/xmlenc#sha256',
    );
    expect(refs.some((r) => r.getAttribute('Type') === 'http://uri.etsi.org/01903#SignedProperties')).toBe(true);
  });

  it('el DigestValue de #comprobante coincide con el C14N exclusivo del documento sin la firma', () => {
    const copy = parse(signed);
    const signature = copy.getElementsByTagNameNS(DS, 'Signature')[0];
    const ref = Array.from(signature.getElementsByTagNameNS(DS, 'Reference') as unknown as ArrayLike<Element>).find(
      (r) => r.getAttribute('URI') === '#comprobante',
    )!;
    const expected = ref.getElementsByTagNameNS(DS, 'DigestValue')[0].textContent!.trim();
    signature.parentNode!.removeChild(signature);
    const canonical = new ExclusiveCanonicalization().process(copy.documentElement as never, {}).toString();
    expect(createHash('sha256').update(canonical, 'utf8').digest('base64')).toBe(expected);
  });

  it('la SignatureValue verifica criptográficamente con la clave pública del certificado', () => {
    const verifier = new SignedXml({ publicCert: cert.certificatePem, getCertFromKeyInfo: () => null });
    verifier.loadSignature(doc.getElementsByTagNameNS(DS, 'Signature')[0] as never);
    expect(verifier.checkSignature(signed)).toBe(true);
  });

  it('una alteración del comprobante invalida la firma', () => {
    const tampered = signed.replace('<importeTotal>11.50</importeTotal>', '<importeTotal>1.50</importeTotal>');
    expect(tampered).not.toBe(signed);
    const verifier = new SignedXml({ publicCert: cert.certificatePem, getCertFromKeyInfo: () => null });
    verifier.loadSignature(parse(tampered).getElementsByTagNameNS(DS, 'Signature')[0] as never);
    let valid: boolean;
    try {
      valid = verifier.checkSignature(tampered);
    } catch {
      valid = false;
    }
    expect(valid).toBe(false);
  });

  it('preserva los caracteres UTF-8 y el escape del comprobante', () => {
    expect(signed).toContain('PÉREZ &amp; HIJOS ñ');
  });

  it('usa la hora actual por defecto', async () => {
    const before = Date.now();
    const out = await new FirmaEcXadesSigner().sign(xml, cert);
    const t = new Date(parse(out).getElementsByTagNameNS(XADES, 'SigningTime')[0].textContent!).getTime();
    expect(t).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(t).toBeLessThanOrEqual(Date.now());
  });

  it('con contraseña incorrecta rechaza con "Error al firmar XML" y conserva la causa', async () => {
    const err = await new FirmaEcXadesSigner().sign(xml, { p12: cert.p12, password: 'incorrecta' }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/^Error al firmar XML: /);
    expect(err.cause).toBeDefined();
  });

  // firmaec.js 5.2.0 lanza "Clave de firma incorrecta o archivo PKCS#12 dañado": debe traducirse al mensaje amigable.
  it('con contraseña incorrecta el mensaje menciona la contraseña del certificado', async () => {
    await expect(new FirmaEcXadesSigner().sign(xml, { p12: cert.p12, password: 'incorrecta' })).rejects.toThrow(
      'Error al firmar XML: contraseña del certificado incorrecta',
    );
  });

  it('con un .p12 corrupto rechaza', async () => {
    await expect(
      new FirmaEcXadesSigner().sign(xml, { p12: Buffer.from('no es un p12'), password: 'x' }),
    ).rejects.toThrow(/Error al firmar XML/);
  });

  it('otros errores conservan el mensaje original de firmaec.js', async () => {
    const err = await new FirmaEcXadesSigner().sign('esto no es xml', cert).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/^Error al firmar XML: /);
    expect(err.message).not.toMatch(/contraseña/);
  });
});
