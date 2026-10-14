import { ValidationError } from '../../../domain/shared/errors';
import { parseAmount } from '../../../domain/shared/money';
import { IssueDebitNoteCommand } from '../application/IssueDebitNote';

/** Acepta `[{ impuesto: {...} }]` (ficha técnica) o `[{...}]`. */
const unwrap = (item: any, key: string) => (item && typeof item === 'object' && key in item ? item[key] : item);
const optionalAmount = (value: unknown, field: string) =>
  value === undefined || value === null || value === '' ? undefined : parseAmount(value, field);
const optionalCode = (value: unknown) =>
  value === undefined || value === null || value === '' ? undefined : String(value).trim();

/**
 * Traduce el payload público `{ nota_debito: {...} }` (nombres de la ficha técnica del SRI,
 * igual que el PR original) al comando del caso de uso. Los importes del cliente
 * (`totalSinImpuestos`, `impuestos`, `valorTotal`) solo se usan para validar.
 */
export function toIssueDebitNoteCommand(body: any): IssueDebitNoteCommand {
  const nota = body?.nota_debito;
  if (!nota || typeof nota !== 'object') throw new ValidationError('Debit note data is required (nota_debito)');
  const { infoTributaria, infoNotaDebito: info, motivos } = nota;
  if (!infoTributaria?.ruc || !info || typeof info !== 'object') {
    throw new ValidationError('Datos de nota de débito inválidos o incompletos');
  }
  if (!Array.isArray(motivos) || !motivos.length) {
    throw new ValidationError('La nota de débito debe tener al menos un motivo');
  }
  if (!info.tipoIdentificacionComprador || !info.identificacionComprador) {
    throw new ValidationError('tipoIdentificacionComprador e identificacionComprador son requeridos');
  }
  if (!info.codDocModificado || !info.numDocModificado || !info.fechaEmisionDocSustento) {
    throw new ValidationError('codDocModificado, numDocModificado y fechaEmisionDocSustento son requeridos');
  }
  if (info.impuestos !== undefined && !Array.isArray(info.impuestos)) {
    throw new ValidationError('impuestos debe ser una lista');
  }
  if (info.pagos !== undefined && !Array.isArray(info.pagos)) throw new ValidationError('pagos debe ser una lista');
  const extra = nota.infoAdicional;
  if (extra !== undefined && (extra === null || typeof extra !== 'object' || Array.isArray(extra))) {
    throw new ValidationError('infoAdicional debe ser un objeto { nombre: valor }');
  }

  return wrap(() => ({
    issuerRuc: String(infoTributaria.ruc),
    emissionDate: info.fechaEmision || undefined,
    buyer: {
      idType: String(info.tipoIdentificacionComprador),
      id: String(info.identificacionComprador),
      name: info.razonSocialComprador,
      address: info.direccionComprador,
      email: info.emailComprador,
      phone: info.telefonoComprador,
    },
    modifiedDocument: {
      type: String(info.codDocModificado),
      number: String(info.numDocModificado),
      emissionDate: String(info.fechaEmisionDocSustento),
    },
    reasons: motivos.map((item: any, index: number) => {
      const m = unwrap(item, 'motivo');
      if (!m || typeof m !== 'object') throw new ValidationError(`El motivo ${index + 1} es inválido`);
      return {
        reason: String(m.razon ?? ''),
        value: parseAmount(m.valor, `valor del motivo ${index + 1}`),
        ivaCode: optionalCode(m.codigoPorcentaje),
      };
    }),
    declaredTaxes: info.impuestos?.map((item: any, index: number) => {
      const t = unwrap(item, 'impuesto');
      if (!t?.codigoPorcentaje && t?.codigoPorcentaje !== 0) {
        throw new ValidationError(`El impuesto ${index + 1} requiere codigoPorcentaje`);
      }
      return {
        taxCode: optionalCode(t.codigo),
        ivaCode: String(t.codigoPorcentaje),
        rate: optionalAmount(t.tarifa, `tarifa del impuesto ${index + 1}`),
        base: optionalAmount(t.baseImponible, `baseImponible del impuesto ${index + 1}`),
        value: optionalAmount(t.valor, `valor del impuesto ${index + 1}`),
      };
    }),
    payments: info.pagos?.map((item: any, index: number) => {
      const p = unwrap(item, 'pago');
      if (!p?.formaPago) throw new ValidationError(`El pago ${index + 1} requiere formaPago`);
      return {
        method: String(p.formaPago),
        amount: parseAmount(p.total, `total del pago ${index + 1}`),
        term: optionalAmount(p.plazo, `plazo del pago ${index + 1}`),
        timeUnit: p.unidadTiempo || undefined,
      };
    }),
    additionalInfo: extra,
    expectedTotals: {
      subtotal: optionalAmount(info.totalSinImpuestos, 'totalSinImpuestos'),
      total: optionalAmount(info.valorTotal, 'valorTotal'),
    },
    rawRequest: nota,
  }));
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
