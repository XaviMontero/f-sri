import forge from 'node-forge';

export interface TestCertificate {
  p12: Buffer;
  password: string;
  certificatePem: string;
  /** Certificado en base64 DER, como aparece en <ds:X509Certificate>. */
  certificateBase64: string;
}

let cached: TestCertificate | undefined;

/**
 * Genera (una vez por proceso) un .p12 autofirmado RSA-2048 con estructura de certificado
 * ecuatoriano de persona natural, para probar la firma sin usar un certificado real.
 */
export function testCertificate(password = 'clave-de-prueba'): TestCertificate {
  if (cached && cached.password === password) return cached;
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: 'commonName', value: 'EMISOR DE PRUEBA' },
    { name: 'countryName', value: 'EC' },
    { name: 'organizationName', value: 'F-SRI TEST' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: '3des',
    friendlyName: 'test',
  });
  const p12 = Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
  const certificatePem = forge.pki.certificateToPem(cert);
  const certificateBase64 = Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
    'binary',
  ).toString('base64');
  cached = { p12, password, certificatePem, certificateBase64 };
  return cached;
}
