/** Certificado de firma electrónica (.p12/.pfx) con su clave, ya descifrada. */
export interface SigningCertificate {
  p12: Buffer;
  password: string;
}

/** Firma XAdES-BES de comprobantes electrónicos del SRI. */
export interface DocumentSigner {
  sign(xml: string, certificate: SigningCertificate): Promise<string>;
}

/** Entrega el certificado de un emisor sin exponer cómo se almacena ni se cifra. */
export interface CertificateStore {
  forIssuer(issuerId: string): Promise<SigningCertificate>;
}
