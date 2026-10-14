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

function selfSigned(cn: string, keyUsage: Record<string, boolean>) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = cn === 'CIFRADO' ? '02' : '03';
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: 'commonName', value: cn },
    { name: 'countryName', value: 'EC' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'keyUsage', ...keyUsage }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { keys, cert };
}

/**
 * .p12 con DOS claves, como entregan algunas entidades: primero una de solo cifrado
 * (keyEncipherment) y después la de firma (digitalSignature). Devuelve el certificado de firma.
 */
export function multiKeyCertificate(password = 'clave-multi'): TestCertificate {
  const encryption = selfSigned('CIFRADO', { keyEncipherment: true, dataEncipherment: true });
  const signing = selfSigned('FIRMA', { digitalSignature: true, nonRepudiation: true });

  // Cada PFX sin MAC: su authSafe es una SEQUENCE de ContentInfo que se puede concatenar.
  const authSafeOf = (key: forge.pki.PrivateKey, cert: forge.pki.Certificate, name: string) => {
    const pfx = forge.pkcs12.toPkcs12Asn1(key, [cert], password, {
      algorithm: '3des',
      friendlyName: name,
      useMac: false,
    });
    const contentInfo = (pfx.value as forge.asn1.Asn1[])[1];
    const explicit = (contentInfo.value as forge.asn1.Asn1[])[1];
    const octets = (explicit.value as forge.asn1.Asn1[])[0];
    return forge.asn1.fromDer(octets.value as string);
  };
  const first = authSafeOf(encryption.keys.privateKey, encryption.cert, 'cifrado');
  const second = authSafeOf(signing.keys.privateKey, signing.cert, 'firma');
  const merged = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
    ...(first.value as forge.asn1.Asn1[]),
    ...(second.value as forge.asn1.Asn1[]),
  ]);

  const template = forge.pkcs12.toPkcs12Asn1(signing.keys.privateKey, [signing.cert], password, { useMac: false });
  const contentInfo = (template.value as forge.asn1.Asn1[])[1];
  const explicit = (contentInfo.value as forge.asn1.Asn1[])[1];
  (explicit.value as forge.asn1.Asn1[])[0] = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.OCTETSTRING,
    false,
    forge.asn1.toDer(merged).getBytes(),
  );
  const p12 = Buffer.from(forge.asn1.toDer(template).getBytes(), 'binary');
  const certificateBase64 = Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(signing.cert)).getBytes(),
    'binary',
  ).toString('base64');
  return { p12, password, certificatePem: forge.pki.certificateToPem(signing.cert), certificateBase64 };
}
