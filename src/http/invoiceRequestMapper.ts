import { IssueInvoiceCommand } from '../application/use-cases/IssueInvoice';
import { ValidationError } from '../domain/shared/errors';
import { parseAmount } from '../domain/shared/money';

/**
 * Traduce el payload público `{ factura: {...} }` (nombres de la ficha técnica del SRI)
 * al comando del caso de uso. Los totales que envíe el cliente solo se usan para validar.
 */
export function toIssueInvoiceCommand(factura: any): IssueInvoiceCommand {
  if (!factura || typeof factura !== 'object') throw new ValidationError('Invoice data is required');
  const { infoTributaria, infoFactura, detalles } = factura;
  if (!infoTributaria?.ruc || !infoFactura || !Array.isArray(detalles) || !detalles.length) {
    throw new ValidationError('Datos de factura inválidos o incompletos');
  }
  if (!infoFactura.tipoIdentificacionComprador || !infoFactura.identificacionComprador) {
    throw new ValidationError('tipoIdentificacionComprador e identificacionComprador son requeridos');
  }

  return wrap(() => ({
    issuerRuc: String(infoTributaria.ruc),
    emissionDate: infoFactura.fechaEmision || undefined,
    buyer: {
      idType: String(infoFactura.tipoIdentificacionComprador),
      id: String(infoFactura.identificacionComprador),
      name: infoFactura.razonSocialComprador,
      address: infoFactura.direccionComprador,
      email: infoFactura.emailComprador,
      phone: infoFactura.telefonoComprador,
    },
    lines: detalles.map((item: any, index: number) => {
      const d = item?.detalle ?? item;
      if (!d?.codigoPrincipal) throw new ValidationError(`El detalle ${index + 1} requiere codigoPrincipal`);
      const impuesto = d.impuestos?.[0]?.impuesto ?? d.impuestos?.[0];
      return {
        code: String(d.codigoPrincipal),
        description: d.descripcion,
        quantity: parseAmount(d.cantidad, `cantidad del detalle ${index + 1}`),
        unitPrice:
          d.precioUnitario === undefined
            ? undefined
            : parseAmount(d.precioUnitario, `precioUnitario del detalle ${index + 1}`),
        discount:
          d.descuento === undefined ? undefined : parseAmount(d.descuento, `descuento del detalle ${index + 1}`),
        ivaCode: impuesto?.codigoPorcentaje === undefined ? undefined : String(impuesto.codigoPorcentaje),
      };
    }),
    payments: Array.isArray(infoFactura.pagos)
      ? infoFactura.pagos.map((p: any) => ({
          method: String(p.formaPago),
          amount: parseAmount(p.total, 'total del pago'),
          term: p.plazo === undefined ? undefined : parseAmount(p.plazo, 'plazo'),
          timeUnit: p.unidadTiempo,
        }))
      : undefined,
    tip: infoFactura.propina === undefined ? undefined : parseAmount(infoFactura.propina, 'propina'),
    additionalInfo: factura.infoAdicional,
    expectedTotals: {
      subtotal:
        infoFactura.totalSinImpuestos === undefined
          ? undefined
          : parseAmount(infoFactura.totalSinImpuestos, 'totalSinImpuestos'),
      total: infoFactura.importeTotal === undefined ? undefined : parseAmount(infoFactura.importeTotal, 'importeTotal'),
    },
    rawRequest: factura,
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
