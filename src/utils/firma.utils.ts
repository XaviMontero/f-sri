import fs from 'fs';
import forge from 'node-forge';
import { signInvoiceXml } from 'ec-sri-invoice-signer';

/**
 * Firma un documento XML usando la librería oficial ec-sri-invoice-signer
 * Extrae el certificado correcto (Persona Natural) del P12 antes de firmar
 * @param xmlString String del XML a firmar
 * @param p12Path Ruta al archivo P12 del certificado
 * @param password Contraseña del certificado P12
 * @returns String del XML firmado
 */
export async function firmarXML(xmlString: string, p12Path: string, password: string): Promise<string> {
  try {
    console.log('P12 Path:', p12Path);
    const p12Buffer = fs.readFileSync(p12Path);

    // Decodificar el P12 para extraer el certificado correcto
    const p12Base64 = p12Buffer.toString('base64');
    const p12Der = forge.util.decode64(p12Base64);
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, true, password || '');

    console.log('P12 parsed successfully');
    console.log('All bags:', Object.keys(p12.getBags({})));

    // Extraer certificados
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const allKeyBags = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
    const keyBag2 = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];
    const allKeyBags2 = keyBag2 || [];

    console.log('Key bags found:', Object.keys(keyBags));
    console.log('Total PKCS#8 keys:', allKeyBags.length);
    console.log('Total RSA keys:', allKeyBags2.length);

    // Primero: Seleccionar el certificado de firma digital (serial más alto, no CA)
    let correctCert: any = null;
    let correctCertSerial: string = '';
    let correctCertLocalKeyId: any = null;

    console.log('\n=== Buscando certificado de firma digital ===');
    for (const certBag of certBags) {
      if (!certBag.cert) continue;
      
      const cn = certBag.cert.subject.getField({ shortName: 'CN' })?.value || '';
      const serial = certBag.cert.serialNumber;
      const certLocalKeyId = certBag.attributes?.localKeyId?.[0];
      
      // Solo considerar certificados que no sean CA/AUTORIDAD
      if (!cn.includes('AUTORIDAD') && !cn.includes('AC ')) {
        console.log(`Candidate: ${cn}, Serial: ${serial}`);
        
        // Seleccionar el certificado con serial más alto
        if (!correctCert || parseInt(serial, 16) > parseInt(correctCertSerial, 16)) {
          correctCert = certBag.cert;
          correctCertSerial = serial;
          correctCertLocalKeyId = certLocalKeyId;
          console.log(`  ✅ Nuevo mejor candidato seleccionado`);
        }
      }
    }

    if (!correctCert) {
      throw new Error('No se encontró certificado de firma digital (Persona Natural) en el P12');
    }

    console.log(`\n✅ Certificado de firma digital seleccionado: ${correctCert.subject.getField({ shortName: 'CN' })?.value}, Serial: ${correctCertSerial}`);

    // Segundo: Buscar la clave privada que corresponde a este certificado
    console.log(`\n=== Buscando clave privada para localKeyId: ${JSON.stringify(correctCertLocalKeyId)} ===`);
    let correctKeyBag: any = null;

    for (const keyBag of allKeyBags) {
      const keyLocalKeyId = keyBag.attributes?.localKeyId?.[0];
      console.log(`  PKCS#8 Key localKeyId: ${JSON.stringify(keyLocalKeyId)}, Match: ${keyLocalKeyId === correctCertLocalKeyId}`);
      if (keyLocalKeyId === correctCertLocalKeyId) {
        correctKeyBag = keyBag;
        console.log(`    ✅ Clave encontrada`);
        break;
      }
    }

    if (!correctKeyBag) {
      for (const keyBag of allKeyBags2) {
        const keyLocalKeyId = keyBag.attributes?.localKeyId?.[0];
        console.log(`  RSA Key localKeyId: ${JSON.stringify(keyLocalKeyId)}, Match: ${keyLocalKeyId === correctCertLocalKeyId}`);
        if (keyLocalKeyId === correctCertLocalKeyId) {
          correctKeyBag = keyBag;
          console.log(`    ✅ Clave encontrada`);
          break;
        }
      }
    }

    if (!correctKeyBag || !correctKeyBag.key) {
      throw new Error('No se encontró clave privada asociada al certificado de firma digital');
    }

    // Convertir clave privada a formato PEM y de vuelta para asegurar compatibilidad
    const privateKeyPem = forge.pki.privateKeyToPem(correctKeyBag.key);
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);

    // Crear un P12 temporal solo con el certificado y clave correctos
    const tempP12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, correctCert, password || '');
    const tempP12Der = forge.asn1.toDer(tempP12Asn1).getBytes();
    const tempP12Buffer = Buffer.from(tempP12Der, 'binary');

    // Firmar usando la librería oficial del SRI con el P12 temporal
    const signedXml = signInvoiceXml(xmlString, tempP12Buffer, {
      pkcs12Password: password || ''
    });

    // Guardar para debugging
    guardarXMLFirmado(signedXml, "./firmado.xml");

    return signedXml;
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