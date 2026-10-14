import { DocumentSigner, SigningCertificate } from '../../application/ports/signing';

/** Subconjunto de la API pública de firmaec.js que usa este adaptador. */
interface FirmaEcModule {
  firmarXml(
    xml: string | Uint8Array,
    p12: Uint8Array,
    clave: string,
    opciones?: { signingTime?: Date },
  ): Promise<Buffer>;
}

let firmaec: Promise<FirmaEcModule> | undefined;

/**
 * firmaec.js es un paquete ESM; este proyecto compila a CommonJS. Con
 * `module: node16` TypeScript conserva el `import()` dinámico, que Node resuelve sin flags.
 */
function loadFirmaEc(): Promise<FirmaEcModule> {
  firmaec ??= import('firmaec.js') as Promise<FirmaEcModule>;
  return firmaec;
}

/**
 * Adaptador de firma XAdES-BES para el SRI sobre firmaec.js
 * (port a Node de la librería oficial FirmaEC): enveloped sobre `#comprobante`, SHA-256.
 */
export class FirmaEcXadesSigner implements DocumentSigner {
  constructor(private readonly clock: () => Date = () => new Date()) {}

  async sign(xml: string, certificate: SigningCertificate): Promise<string> {
    const { firmarXml } = await loadFirmaEc();
    try {
      const signed = await firmarXml(xml, certificate.p12, certificate.password, { signingTime: this.clock() });
      return signed.toString('utf8');
    } catch (error) {
      throw new Error(`Error al firmar XML: ${describe(error)}`, { cause: error });
    }
  }
}

function describe(error: unknown): string {
  const message = (error as Error)?.message ?? String(error);
  if (/mac|password|contrase|clave de firma|pkcs#?12/i.test(message)) return 'contraseña del certificado incorrecta';
  return message;
}
