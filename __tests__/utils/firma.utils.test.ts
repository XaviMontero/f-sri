import fs from 'fs';
import os from 'os';
import path from 'path';
import forge from 'node-forge';

const signInvoiceXmlMock = jest.fn().mockReturnValue('<factura>firmada</factura>');
const signCreditNoteXmlMock = jest.fn().mockReturnValue('<notaCredito>firmada</notaCredito>');

jest.mock('ec-sri-invoice-signer', () => ({
  signInvoiceXml: (...args: any[]) => signInvoiceXmlMock(...args),
  signCreditNoteXml: (...args: any[]) => signCreditNoteXmlMock(...args),
  signDebitNoteXml: jest.fn(),
  signDeliveryGuideXml: jest.fn(),
  signWithholdingCertificateXml: jest.fn(),
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
