import IssuingCompany from '../../models/IssuingCompany';
import { CertificateStore, SigningCertificate } from '../../application/ports/signing';
import { decrypt } from '../../utils/encryption.utils';

/**
 * Lee el .p12 (base64) y su contraseña cifrada del emisor. El certificado se usa en
 * memoria: nunca se escribe a disco ni se prueban contraseñas alternativas.
 */
export class MongoCertificateStore implements CertificateStore {
  async forIssuer(issuerId: string): Promise<SigningCertificate> {
    const company = await IssuingCompany.findById(issuerId).select('certificate certificate_password').lean();
    if (!company?.certificate?.trim()) {
      throw new Error('La empresa emisora no tiene certificado de firma electrónica cargado');
    }
    const p12 = Buffer.from(company.certificate, 'base64');
    if (!p12.length) throw new Error('El certificado de la empresa está vacío o no es base64 válido');
    return { p12, password: decryptPassword(company.certificate_password ?? '') };
  }
}

/** Las contraseñas se guardan como `iv:cifrado`; se toleran las antiguas en texto plano. */
export function decryptPassword(stored: string): string {
  if (/^[0-9a-f]{32}:[0-9a-f]+$/i.test(stored)) return decrypt(stored);
  return stored;
}
