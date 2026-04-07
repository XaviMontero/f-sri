import fs from 'fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
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
    const certPart = pemData.split('-----BEGIN CERTIFICATE-----')[1]?.split('-----END CERTIFICATE-----')[0];
    if (!certPart) throw new Error('No se pudo encontrar el certificado en el archivo PEM');

    const certPem = `-----BEGIN CERTIFICATE-----${certPart}-----END CERTIFICATE-----`;
    const certificate = forge.pki.certificateFromPem(certPem);
    const certBase64 = certPart.replace(/\r?\n|\r/g, '');

    let privateKeyPem = '';
    if (pemData.includes('-----BEGIN RSA PRIVATE KEY-----')) {
       privateKeyPem = `-----BEGIN RSA PRIVATE KEY-----${pemData.split('-----BEGIN RSA PRIVATE KEY-----')[1].split('-----END RSA PRIVATE KEY-----')[0]}-----END RSA PRIVATE KEY-----`;
    } else if (pemData.includes('-----BEGIN PRIVATE KEY-----')) {
       privateKeyPem = `-----BEGIN PRIVATE KEY-----${pemData.split('-----BEGIN PRIVATE KEY-----')[1].split('-----END PRIVATE KEY-----')[0]}-----END PRIVATE KEY-----`;
    }
    if (!privateKeyPem) throw new Error('No se encontró la clave privada');
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);

    // Generación de identificadores únicos para la firma (estilo SRI)
    const salt = Math.floor(Math.random() * 1000000);
    const signatureId = `Signature${salt}`;
    const signedInfoId = `Signature-SignedInfo${salt + 1}`;
    const signedPropertiesId = `Signature${salt}-SignedProperties${salt + 2}`;
    const certificateId = `Certificate${salt + 3}`;
    const referenceId = `Reference-ID-${salt + 4}`;
    const signatureValueId = `SignatureValue${salt + 5}`;
    const objectId = `Signature${salt}-Object${salt + 6}`;
    const signedPropertiesRefId = `SignedPropertiesID${salt + 7}`;

    const signingTime = new Date().toISOString().split('.')[0] + '-05:00';

    // Datos del emisor del certificado
    const issuerAttributes = certificate.issuer.attributes.map(attr => {
      const name = attr.shortName || attr.name;
      return `${name}=${attr.value}`;
    }).reverse().join(',');
    const serialNumber = certificate.serialNumber;

    // Digest del certificado
    const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
    const certDigest = forge.util.encode64(forge.md.sha1.create().update(certDer).digest().getBytes());

    // Datos de la llave pública
    const publicKey = certificate.publicKey as forge.pki.rsa.PublicKey;
    const modulus = forge.util.encode64(forge.util.hexToBytes(publicKey.n.toString(16)));
    const exponent = forge.util.encode64(forge.util.hexToBytes(publicKey.e.toString(16)));

    const doc = new DOMParser().parseFromString(xmlString, 'text/xml');
    const facturaElement = doc.getElementsByTagName('factura')[0];
    facturaElement.setAttribute('id', 'comprobante');
    
    const serializer = new XMLSerializer();
    const facturaXml = serializer.serializeToString(facturaElement);
    const docDigest = forge.util.encode64(forge.md.sha1.create().update(facturaXml).digest().getBytes());

    // Construcción del bloque SignedProperties (XAdES)
    const signedPropertiesXml = `
<etsi:SignedProperties xmlns:etsi="http://uri.etsi.org/01903/v1.3.2#" Id="${signedPropertiesId}">
    <etsi:SignedSignatureProperties>
        <etsi:SigningTime>${signingTime}</etsi:SigningTime>
        <etsi:SigningCertificate>
            <etsi:Cert>
                <etsi:CertDigest>
                    <ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>
                    <ds:DigestValue>${certDigest}</ds:DigestValue>
                </etsi:CertDigest>
                <etsi:IssuerSerial>
                    <ds:X509IssuerName>${issuerAttributes}</ds:X509IssuerName>
                    <ds:X509SerialNumber>${parseInt(serialNumber, 16)}</ds:X509SerialNumber>
                </etsi:IssuerSerial>
            </etsi:Cert>
        </etsi:SigningCertificate>
    </etsi:SignedSignatureProperties>
    <etsi:SignedDataObjectProperties>
        <etsi:DataObjectFormat ObjectReference="#${referenceId}">
            <etsi:Description>contenido comprobante</etsi:Description>
            <etsi:MimeType>text/xml</etsi:MimeType>
        </etsi:DataObjectFormat>
    </etsi:SignedDataObjectProperties>
</etsi:SignedProperties>`.trim();
    
    const signedPropertiesDigest = forge.util.encode64(forge.md.sha1.create().update(signedPropertiesXml).digest().getBytes());

    // Construcción del bloque SignedInfo con las 3 referencias requeridas
    const signedInfoXml = `
<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="${signedInfoId}">
    <ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></ds:CanonicalizationMethod>
    <ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></ds:SignatureMethod>
    <ds:Reference Id="${signedPropertiesRefId}" Type="http://uri.etsi.org/01903#SignedProperties" URI="#${signedPropertiesId}">
        <ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>
        <ds:DigestValue>${signedPropertiesDigest}</ds:DigestValue>
    </ds:Reference>
    <ds:Reference URI="#${certificateId}">
        <ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>
        <ds:DigestValue>${certDigest}</ds:DigestValue>
    </ds:Reference>
    <ds:Reference Id="${referenceId}" URI="#comprobante">
        <ds:Transforms>
            <ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform>
        </ds:Transforms>
        <ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>
        <ds:DigestValue>${docDigest}</ds:DigestValue>
    </ds:Reference>
</ds:SignedInfo>`.trim();

    // Cálculo del valor de la firma sobre SignedInfo
    const md = forge.md.sha1.create();
    md.update(signedInfoXml, 'utf8');
    const signatureValue = forge.util.encode64(privateKey.sign(md));

    // Ensamblaje final de la Firma Digital
    const signatureXml = `
<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:etsi="http://uri.etsi.org/01903/v1.3.2#" Id="${signatureId}">
    ${signedInfoXml}
    <ds:SignatureValue Id="${signatureValueId}">
        ${signatureValue}
    </ds:SignatureValue>
    <ds:KeyInfo Id="${certificateId}">
        <ds:X509Data>
            <ds:X509Certificate>${certBase64}</ds:X509Certificate>
        </ds:X509Data>
        <ds:KeyValue>
            <ds:RSAKeyValue>
                <ds:Modulus>${modulus}</ds:Modulus>
                <ds:Exponent>${exponent}</ds:Exponent>
            </ds:RSAKeyValue>
        </ds:KeyValue>
    </ds:KeyInfo>
    <ds:Object Id="${objectId}">
        <etsi:QualifyingProperties xmlns:etsi="http://uri.etsi.org/01903/v1.3.2#" Target="#${signatureId}">
            ${signedPropertiesXml}
        </etsi:QualifyingProperties>
    </ds:Object>
</ds:Signature>`.trim();

    const signatureNode = new DOMParser().parseFromString(signatureXml, 'text/xml').documentElement;
    facturaElement.appendChild(signatureNode);

    return serializer.serializeToString(doc);
  } catch (error: any) {
    console.error('Error signing XML:', error.message);
    throw new Error(`Error al firmar XML: ${error.message}`);
  }
}

/**
 * Guarda un XML firmado en un archivo
 */
export function guardarXMLFirmado(xmlString: string, outputPath: string): void {
  fs.writeFileSync(outputPath, xmlString, { encoding: 'utf8' });
}