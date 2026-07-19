import fs from 'fs';
import forge from 'node-forge';
import {
  signInvoiceXml,
  signCreditNoteXml,
  signDebitNoteXml,
  signDeliveryGuideXml,
  signWithholdingCertificateXml,
} from 'ec-sri-invoice-signer';

/**
 * Códigos de tipo de documento según la tabla 3 de la Ficha Técnica del SRI
 */
export type TipoDocumento = '01' | '04' | '05' | '06' | '07';

type SignerFn = (xml: string, p12Data: Buffer, options?: { pkcs12Password?: string }) => string;

const FIRMADORES: Record<TipoDocumento, SignerFn> = {
  '01': signInvoiceXml,
  '04': signCreditNoteXml,
  '05': signDebitNoteXml,
  '06': signDeliveryGuideXml,
  '07': signWithholdingCertificateXml,
};

/**
 * Determines whether a certificate is a CA certificate (part of the chain, not the signer)
 */
function esCertificadoCA(cert: forge.pki.Certificate): boolean {
  const basicConstraints = cert.getExtension('basicConstraints') as { cA?: boolean } | null;
  if (basicConstraints && typeof basicConstraints.cA === 'boolean') {
    return basicConstraints.cA;
  }
  // Fallback heuristic for certificates without basicConstraints
  const cn = cert.subject.getField({ shortName: 'CN' })?.value || '';
  return cn.includes('AUTORIDAD') || cn.startsWith('AC ');
}

/**
 * Extracts the signing certificate and its private key from a P12 file.
 * Ecuadorian P12 files (BCE, Security Data, etc.) usually bundle the CA chain,
 * so the signer certificate is selected by matching the private key's localKeyId,
 * with a fallback to the first non-CA certificate.
 */
function extraerCertificadoFirmante(
  p12Buffer: Buffer,
  password: string,
): { certificado: forge.pki.Certificate; clavePrivada: forge.pki.PrivateKey } {
  const p12Der = forge.util.decode64(p12Buffer.toString('base64'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, true, password);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];

  const keyBag = keyBags[0];
  if (!keyBag || !keyBag.key) {
    throw new Error('No se encontró una clave privada en el archivo P12');
  }

  const keyLocalKeyId = keyBag.attributes?.localKeyId?.[0];

  // Preferred: certificate whose localKeyId matches the private key's localKeyId
  let certificado: forge.pki.Certificate | undefined;
  if (keyLocalKeyId) {
    certificado = certBags.find((bag) => bag.cert && bag.attributes?.localKeyId?.[0] === keyLocalKeyId)?.cert as
      | forge.pki.Certificate
      | undefined;
  }

  // Fallback: first non-CA certificate
  if (!certificado) {
    certificado = certBags.find((bag) => bag.cert && !esCertificadoCA(bag.cert))?.cert as
      | forge.pki.Certificate
      | undefined;
  }

  // Last resort: first certificate available
  if (!certificado) {
    certificado = certBags[0]?.cert as forge.pki.Certificate | undefined;
  }

  if (!certificado) {
    throw new Error('No se encontró el certificado de firma digital en el archivo P12');
  }

  return { certificado, clavePrivada: keyBag.key };
}

/**
 * Firma un documento XML según el estándar XAdES-BES exigido por el SRI,
 * usando la librería ec-sri-invoice-signer.
 *
 * Se reconstruye un P12 mínimo (certificado firmante + clave privada) para evitar
 * ambigüedad cuando el archivo original incluye la cadena de certificados de la CA.
 *
 * @param xmlString String del XML a firmar (nodo raíz con id="comprobante")
 * @param p12Path Ruta al archivo P12 del certificado digital
 * @param password Contraseña del certificado P12
 * @param tipoDocumento Código del tipo de documento (tabla 3 del SRI). Por defecto '01' (factura)
 * @returns String del XML firmado
 */
export async function firmarXML(
  xmlString: string,
  p12Path: string,
  password: string,
  tipoDocumento: TipoDocumento = '01',
): Promise<string> {
  try {
    const p12Buffer = fs.readFileSync(p12Path);
    const { certificado, clavePrivada } = extraerCertificadoFirmante(p12Buffer, password || '');

    // Minimal P12 with only the signing certificate and its key
    const p12MinimoAsn1 = forge.pkcs12.toPkcs12Asn1(clavePrivada, certificado, password || '');
    const p12MinimoDer = forge.asn1.toDer(p12MinimoAsn1).getBytes();
    const p12Minimo = Buffer.from(p12MinimoDer, 'binary');

    const firmador = FIRMADORES[tipoDocumento];
    if (!firmador) {
      throw new Error(`Tipo de documento no soportado para firma: ${tipoDocumento}`);
    }

    return firmador(xmlString, p12Minimo, { pkcs12Password: password || '' });
  } catch (error: any) {
    console.error('Error signing XML:', error.message);
    throw new Error(`Error al firmar XML: ${error.message}`);
  }
}

/**
 * Guarda un XML firmado en el sistema de archivos
 */
export function guardarXMLFirmado(xmlString: string, outputPath: string): void {
  fs.writeFileSync(outputPath, xmlString, { encoding: 'utf8' });
}
