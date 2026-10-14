import { ValidationError } from '../../../domain/shared/errors';
import { parseAmount } from '../../../domain/shared/money';
import { IssueWithholdingCommand } from '../application/IssueWithholding';
import { SupportDocumentInput } from '../domain/Withholding';

/**
 * Traduce el payload público `{ retencion: {...} }` (nombres de la ficha técnica, ATS 2.0.0)
 * al comando del caso de uso. Los valores calculables (valorRetenido, valorImpuesto) que envíe
 * el cliente solo se usan para validar. Los ítems aceptan la forma envuelta
 * (`{ docSustento: {...} }`, `{ retencion: {...} }`…) o el objeto directo.
 */
export function toIssueWithholdingCommand(body: any): IssueWithholdingCommand {
  const retencion = body?.retencion;
  if (!retencion || typeof retencion !== 'object') throw new ValidationError('Withholding data is required');
  const { infoTributaria, infoCompRetencion: info, docsSustento } = retencion;
  if (!infoTributaria?.ruc || !info || !Array.isArray(docsSustento) || !docsSustento.length) {
    throw new ValidationError('Datos de comprobante de retención inválidos o incompletos');
  }

  return wrap(() => ({
    issuerRuc: String(infoTributaria.ruc),
    emissionDate: info.fechaEmision || undefined,
    fiscalPeriod: info.periodoFiscal === undefined ? undefined : String(info.periodoFiscal),
    subject: {
      idType: str(info.tipoIdentificacionSujetoRetenido) ?? '',
      id: str(info.identificacionSujetoRetenido) ?? '',
      name: str(info.razonSocialSujetoRetenido) ?? '',
      subjectType: str(info.tipoSujetoRetenido),
      relatedParty: str(info.parteRel),
    },
    supportDocuments: docsSustento.map((item: any, index: number) => supportDocument(item, index + 1)),
    additionalInfo: retencion.infoAdicional,
    rawRequest: retencion,
  }));
}

function supportDocument(item: any, n: number): SupportDocumentInput {
  const d = item?.docSustento ?? item;
  const where = `docSustento ${n}`;
  if (!d || typeof d !== 'object') throw new ValidationError(`${where}: datos requeridos`);
  return {
    supportCode: str(d.codSustento) ?? '',
    documentType: str(d.codDocSustento) ?? '',
    number: str(d.numDocSustento),
    emissionDate: str(d.fechaEmisionDocSustento) ?? '',
    accountingDate: str(d.fechaRegistroContable),
    authorizationNumber: str(d.numAutDocSustento),
    paymentLocation: str(d.pagoLocExt),
    subtotal: parseAmount(d.totalSinImpuestos, `${where}: totalSinImpuestos`),
    total: parseAmount(d.importeTotal, `${where}: importeTotal`),
    taxes: list(d.impuestosDocSustento, 'impuestoDocSustento').map((t, i) => ({
      taxCode: str(t.codImpuestoDocSustento) ?? '',
      rateCode: str(t.codigoPorcentaje) ?? '',
      base: parseAmount(t.baseImponible, `${where}, impuesto ${i + 1}: baseImponible`),
      rate: optionalAmount(t.tarifa, `${where}, impuesto ${i + 1}: tarifa`),
      value: optionalAmount(t.valorImpuesto, `${where}, impuesto ${i + 1}: valorImpuesto`),
    })),
    retentions: list(d.retenciones, 'retencion').map((r, i) => ({
      taxCode: str(r.codigo) ?? '',
      retentionCode: (str(r.codigoRetencion) ?? '').toUpperCase(),
      base: parseAmount(r.baseImponible, `${where}, retención ${i + 1}: baseImponible`),
      percentage: parseAmount(r.porcentajeRetener, `${where}, retención ${i + 1}: porcentajeRetener`),
      value: optionalAmount(r.valorRetenido, `${where}, retención ${i + 1}: valorRetenido`),
    })),
    payments: list(d.pagos, 'pago').map((p, i) => ({
      method: str(p.formaPago) ?? '',
      amount: parseAmount(p.total, `${where}, pago ${i + 1}: total`),
    })),
  };
}

/** Lista de ítems `[{ clave: {...} }]` o `[{...}]`; ausente = vacía (el dominio decide si es obligatoria). */
function list(value: unknown, key: string): any[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${key}: se esperaba un arreglo`);
  return value.map((item) => {
    const inner = item?.[key] ?? item;
    if (!inner || typeof inner !== 'object') throw new ValidationError(`${key}: ítem inválido`);
    return inner;
  });
}

function str(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
}

function optionalAmount(value: unknown, field: string): number | undefined {
  return value === undefined || value === null || value === '' ? undefined : parseAmount(value, field);
}

/** Los errores de parseo numérico son errores de validación del cliente. */
function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError((error as Error).message);
  }
}
