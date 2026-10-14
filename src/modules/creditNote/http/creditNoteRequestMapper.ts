import { ValidationError } from '../../../domain/shared/errors';
import { parseAmount } from '../../../domain/shared/money';
import { IVA_TAX_CODE } from '../../../domain/invoice/catalogs';
import { IssueCreditNoteCommand } from '../application/IssueCreditNote';

/**
 * Traduce el payload público `{ nota_credito: { infoTributaria, infoNotaCredito, detalles,
 * infoAdicional? } }` (nombres de la ficha técnica, compatible con la versión anterior) al
 * comando del caso de uso. Los importes que envíe el cliente (`precioTotalSinImpuesto`,
 * `totalSinImpuestos`, `valorModificacion`) solo se usan para validar los calculados; las
 * tarifas y valores de IVA de cada línea se derivan de `codigoPorcentaje`.
 */
export function toIssueCreditNoteCommand(notaCredito: any): IssueCreditNoteCommand {
  if (!notaCredito || typeof notaCredito !== 'object') throw new ValidationError('Credit note data is required');
  const { infoTributaria, infoNotaCredito: info, detalles } = notaCredito;
  if (!infoTributaria?.ruc || !info || !Array.isArray(detalles) || !detalles.length) {
    throw new ValidationError('Datos de nota de crédito inválidos o incompletos');
  }
  if (!info.tipoIdentificacionComprador || !info.identificacionComprador) {
    throw new ValidationError('tipoIdentificacionComprador e identificacionComprador son requeridos');
  }
  for (const field of ['codDocModificado', 'numDocModificado', 'fechaEmisionDocSustento', 'motivo']) {
    if (info[field] === undefined || info[field] === null || String(info[field]).trim() === '') {
      throw new ValidationError(`${field} es requerido`);
    }
  }
  if (info.moneda !== undefined && String(info.moneda).toUpperCase() !== 'DOLAR') {
    throw new ValidationError('moneda debe ser DOLAR');
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
    reason: String(info.motivo),
    lines: detalles.map((item: any, index: number) => {
      const d = item?.detalle ?? item;
      const n = index + 1;
      const code = d?.codigoInterno ?? d?.codigoPrincipal;
      if (!code) throw new ValidationError(`El detalle ${n} requiere codigoInterno`);
      const impuesto = d.impuestos?.[0]?.impuesto ?? d.impuestos?.[0];
      if (impuesto?.codigo !== undefined && String(impuesto.codigo) !== IVA_TAX_CODE) {
        throw new ValidationError(`El detalle ${n}: solo se admite el impuesto IVA (codigo ${IVA_TAX_CODE})`);
      }
      const amount = (value: unknown, field: string) =>
        value === undefined || value === null || value === ''
          ? undefined
          : parseAmount(value, `${field} del detalle ${n}`);
      return {
        code: String(code),
        auxiliaryCode: d.codigoAdicional ?? d.codigoAuxiliar,
        description: d.descripcion,
        quantity: parseAmount(d.cantidad, `cantidad del detalle ${n}`),
        unitPrice: amount(d.precioUnitario, 'precioUnitario'),
        discount: amount(d.descuento, 'descuento'),
        ivaCode: impuesto?.codigoPorcentaje === undefined ? undefined : String(impuesto.codigoPorcentaje),
        expectedSubtotal: amount(d.precioTotalSinImpuesto, 'precioTotalSinImpuesto'),
      };
    }),
    additionalInfo: toAdditionalInfo(notaCredito.infoAdicional),
    expectedTotals: {
      subtotal:
        info.totalSinImpuestos === undefined ? undefined : parseAmount(info.totalSinImpuestos, 'totalSinImpuestos'),
      total:
        info.valorModificacion === undefined ? undefined : parseAmount(info.valorModificacion, 'valorModificacion'),
    },
    rawRequest: notaCredito,
  }));
}

/** Acepta `{ "Email": "x" }` o `[{ nombre, valor }]`. */
function toAdditionalInfo(input: unknown): Record<string, string> | undefined {
  if (input === undefined || input === null) return undefined;
  if (Array.isArray(input)) {
    return Object.fromEntries(
      input
        .map((c: any) => c?.campoAdicional ?? c)
        .filter((c: any) => c?.nombre)
        .map((c: any) => [String(c.nombre), String(c.valor ?? c.value ?? '')]),
    );
  }
  if (typeof input === 'object') {
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]));
  }
  throw new ValidationError('infoAdicional debe ser un objeto o una lista de { nombre, valor }');
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
