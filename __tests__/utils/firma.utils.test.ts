import fs from 'fs';
import os from 'os';
import path from 'path';
import forge from 'node-forge';

const signInvoiceXmlMock = jest.fn().mockReturnValue('<factura>firmada</factura>');
const signCreditNoteXmlMock = jest.fn().mockReturnValue('<notaCredito>firmada</notaCredito>');
const signDebitNoteXmlMock = jest.fn().mockReturnValue('<notaDebito>firmada</notaDebito>');
const signDeliveryGuideXmlMock = jest.fn().mockReturnValue('<guiaRemision>firmada</guiaRemision>');
const signWithholdingCertificateXmlMock = jest
  .fn()
  .mockReturnValue('<comprobanteRetencion>firmada</comprobanteRetencion>');

jest.mock('ec-sri-invoice-signer', () => ({
  signInvoiceXml: (...args: any[]) => signInvoiceXmlMock(...args),
  signCreditNoteXml: (...args: any[]) => signCreditNoteXmlMock(...args),
  signDebitNoteXml: (...args: any[]) => signDebitNoteXmlMock(...args),
  signDeliveryGuideXml: (...args: any[]) => signDeliveryGuideXmlMock(...args),
  signWithholdingCertificateXml: (...args: any[]) => signWithholdingCertificateXmlMock(...args),
}));

import { firmarXML } from '../../src/utils/firma.utils';

const P12_PASSWORD = 'test-password';

/**
 * Builds a self-signed certificate P12 file for testing
 */
function crearP12DePrueba(): string {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    { shortName: 'CN', value: 'JUAN PEREZ' },
    { shortName: 'C', value: 'EC' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, P12_PASSWORD);
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();

  const p12Path = path.join(os.tmpdir(), `test-cert-${Date.now()}.p12`);
  fs.writeFileSync(p12Path, Buffer.from(p12Der, 'binary'));
  return p12Path;
}

/**
 * Builds a P12 file bundling the signer certificate and its CA chain,
 * as issued by Ecuadorian certificate authorities (BCE, Security Data)
 */
function crearP12ConCadenaCA(): string {
  const caKeys = forge.pki.rsa.generateKeyPair(2048);
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = caKeys.publicKey;
  caCert.serialNumber = '99';
  caCert.validity.notBefore = new Date();
  caCert.validity.notAfter = new Date();
  caCert.validity.notAfter.setFullYear(caCert.validity.notBefore.getFullYear() + 5);
  const caAttrs = [
    { shortName: 'CN', value: 'AUTORIDAD DE CERTIFICACION PRUEBAS' },
    { shortName: 'C', value: 'EC' },
  ];
  caCert.setSubject(caAttrs);
  caCert.setIssuer(caAttrs);
  caCert.setExtensions([{ name: 'basicConstraints', cA: true }]);
  caCert.sign(caKeys.privateKey, forge.md.sha256.create());

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  cert.setSubject([
    { shortName: 'CN', value: 'MARIA GARCIA' },
    { shortName: 'C', value: 'EC' },
  ]);
  cert.setIssuer(caAttrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: false }]);
  cert.sign(caKeys.privateKey, forge.md.sha256.create());

  // CA first so the signer certificate is NOT the first certBag in the file
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [caCert, cert] as any, P12_PASSWORD);
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();

  const p12Path = path.join(os.tmpdir(), `test-cert-ca-${Date.now()}.p12`);
  fs.writeFileSync(p12Path, Buffer.from(p12Der, 'binary'));
  return p12Path;
}

describe('firmarXML', () => {
  let p12Path: string;

  beforeAll(() => {
    p12Path = crearP12DePrueba();
  });

  afterAll(() => {
    if (fs.existsSync(p12Path)) fs.unlinkSync(p12Path);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('signs invoices with signInvoiceXml by default', async () => {
    const resultado = await firmarXML('<factura id="comprobante"/>', p12Path, P12_PASSWORD);

    expect(signInvoiceXmlMock).toHaveBeenCalledTimes(1);
    expect(signCreditNoteXmlMock).not.toHaveBeenCalled();
    expect(resultado).toBe('<factura>firmada</factura>');
  });

  it('signs credit notes with signCreditNoteXml when tipoDocumento is 04', async () => {
    const resultado = await firmarXML('<notaCredito id="comprobante"/>', p12Path, P12_PASSWORD, '04');

    expect(signCreditNoteXmlMock).toHaveBeenCalledTimes(1);
    expect(signInvoiceXmlMock).not.toHaveBeenCalled();
    expect(resultado).toBe('<notaCredito>firmada</notaCredito>');
  });

  it('passes a rebuilt minimal P12 buffer and the password to the signer', async () => {
    await firmarXML('<notaCredito id="comprobante"/>', p12Path, P12_PASSWORD, '04');

    const [xml, p12Buffer, options] = signCreditNoteXmlMock.mock.calls[0];
    expect(xml).toBe('<notaCredito id="comprobante"/>');
    expect(Buffer.isBuffer(p12Buffer)).toBe(true);
    expect(p12Buffer.length).toBeGreaterThan(0);
    expect(options).toEqual({ pkcs12Password: P12_PASSWORD });
  });

  it('signs debit notes, delivery guides and withholding certificates by tipoDocumento', async () => {
    await firmarXML('<notaDebito id="comprobante"/>', p12Path, P12_PASSWORD, '05');
    await firmarXML('<guiaRemision id="comprobante"/>', p12Path, P12_PASSWORD, '06');
    await firmarXML('<comprobanteRetencion id="comprobante"/>', p12Path, P12_PASSWORD, '07');

    expect(signDebitNoteXmlMock).toHaveBeenCalledTimes(1);
    expect(signDeliveryGuideXmlMock).toHaveBeenCalledTimes(1);
    expect(signWithholdingCertificateXmlMock).toHaveBeenCalledTimes(1);
  });

  it('selects the non-CA signing certificate from a P12 with a CA chain', async () => {
    const p12ConCadena = crearP12ConCadenaCA();

    try {
      const resultado = await firmarXML('<factura id="comprobante"/>', p12ConCadena, P12_PASSWORD);

      expect(resultado).toBe('<factura>firmada</factura>');
      // The signer received a rebuilt minimal P12 containing exactly one certificate
      const [, p12Minimo] = signInvoiceXmlMock.mock.calls[0];
      const forgeLib = jest.requireActual('node-forge');
      const asn1 = forgeLib.asn1.fromDer(forgeLib.util.decode64(p12Minimo.toString('base64')));
      const p12 = forgeLib.pkcs12.pkcs12FromAsn1(asn1, true, P12_PASSWORD);
      const certBags = p12.getBags({ bagType: forgeLib.pki.oids.certBag })[forgeLib.pki.oids.certBag] || [];
      expect(certBags).toHaveLength(1);
      const cn = certBags[0].cert.subject.getField({ shortName: 'CN' }).value;
      expect(cn).toBe('MARIA GARCIA');
    } finally {
      fs.unlinkSync(p12ConCadena);
    }
  });

  it('throws a descriptive error when the P12 password is wrong', async () => {
    await expect(firmarXML('<factura id="comprobante"/>', p12Path, 'wrong-password')).rejects.toThrow(
      'Error al firmar XML',
    );
  });

  it('throws a descriptive error when the P12 file does not exist', async () => {
    await expect(firmarXML('<factura id="comprobante"/>', '/tmp/no-existe.p12', P12_PASSWORD)).rejects.toThrow(
      'Error al firmar XML',
    );
  });
});
