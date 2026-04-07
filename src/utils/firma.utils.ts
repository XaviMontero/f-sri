import fs from 'fs';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import forge from 'node-forge';

interface KeyInfoProvider {
  getKeyInfo(): string;
}

/**
 * Firma un documento XML usando un certificado PEM
 * @param xmlString String del XML a firmar
 * @param pemPath Ruta al archivo PEM del certificado
 * @param password Contraseña del certificado (opcional para PEM)
 * @returns String del XML firmado
 */
export async function firmarXML(xmlString: string, pemPath: string, password: string): Promise<string> {
  try {
    const pemData = fs.readFileSync(pemPath, 'utf8');

    // 1. Extraer Certificado (Limpiando cabeceras y saltos de línea)
    const certPart = pemData.split('-----BEGIN CERTIFICATE-----')[1]?.split('-----END CERTIFICATE-----')[0];
    if (!certPart) throw new Error('No se pudo encontrar el certificado');
    const certBase64 = certPart.replace(/\s+/g, '').trim();

    // 2. Extraer Clave Privada
    let privateKeyPem = '';
    if (pemData.includes('-----BEGIN RSA PRIVATE KEY-----')) {
      privateKeyPem = `-----BEGIN RSA PRIVATE KEY-----${pemData.split('-----BEGIN RSA PRIVATE KEY-----')[1]?.split('-----END RSA PRIVATE KEY-----')[0]}-----END RSA PRIVATE KEY-----`;
    } else if (pemData.includes('-----BEGIN PRIVATE KEY-----')) {
      privateKeyPem = `-----BEGIN PRIVATE KEY-----${pemData.split('-----BEGIN PRIVATE KEY-----')[1]?.split('-----END PRIVATE KEY-----')[0]}-----END PRIVATE KEY-----`;
    }
    if (!privateKeyPem) throw new Error('No se encontró la clave privada');

    // 3. CONFIGURACIÓN OFICIAL PARA v6.1.2
    // 1. Configuramos el prefijo 'ds' y los algoritmos
    const sig = new SignedXml({
      privateKey: privateKeyPem,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    } as any);

    // 2. FORZAMOS el prefijo 'ds' manualmente (truco para v6.x)
    (sig as any).signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';

    // 1. Definimos el KeyInfo con el prefijo ds: explícito
    (sig as any).keyInfo = `<ds:X509Data><ds:X509Certificate>${certBase64}</ds:X509Certificate></ds:X509Data>`;

    // 2. Agregamos la referencia (Asegúrate que el XPath coincida con tu XML)
    sig.addReference({
      xpath: "//*[local-name(.)='factura']",
      transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    });

    // 3. EL TRUCO MAESTRO PARA EL SRI:
    // 1. EL TRUCO PARA EVITAR EL HIERARCHY ERROR:
    // Cambiamos 'after' (fuera) por 'append' (dentro al final)
    sig.computeSignature(xmlString, {
      prefix: 'ds',
      attrs: {
        xmlns: 'http://www.w3.org/2000/09/xmldsig#'
      },
      location: {
        // Buscamos la etiqueta factura
        reference: "//*[local-name(.)='factura']",
        // 'append' la mete DENTRO de la factura, al final de los detalles/totales
        action: 'append'
      }
    });

    // 2. IMPORTANTE: En versiones nuevas de xml-crypto, 
    // a veces es necesario pasar el documento parseado si falla el string
    const signedXml = sig.getSignedXml();
    fs.writeFileSync('ultimo_xml_firmado.xml', signedXml);
    return signedXml;

  } catch (error: any) {
    console.error('Error signing XML:', error.message);
    throw new Error(`Error al firmar XML: ${error.message}`);
  }
}
//Ayudita fs.writeFileSync('ultimo_xml_firmado.xml', sig.getSignedXml());

/**
 * Guarda un XML firmado en un archivo
 */
export function guardarXMLFirmado(xmlString: string, outputPath: string): void {
  fs.writeFileSync(outputPath, xmlString, { encoding: 'utf8' });
}
