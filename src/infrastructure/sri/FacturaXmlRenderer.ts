import { XMLBuilder } from 'xmlbuilder2/lib/interfaces';
import { comprobanteRoot, infoAdicional, infoTributaria, optional, text } from './xmlHelpers';
import { Invoice } from '../../domain/invoice/Invoice';
import { formatDecimal, formatMoney } from '../../domain/shared/money';
import { InvoiceXmlRenderer } from '../../application/ports/xml';

/** Versión del esquema: 1.1.0 admite hasta 6 decimales en cantidad y precio unitario. */
export const FACTURA_SCHEMA_VERSION = '1.1.0';

/**
 * Serializa una {@link Invoice} al XML `factura` 1.1.0 de la ficha técnica del SRI.
 * El orden de los elementos es el del XSD; los opcionales vacíos se omiten.
 */
export class FacturaXmlRenderer implements InvoiceXmlRenderer {
  render(invoice: Invoice): string {
    const root = comprobanteRoot('factura', FACTURA_SCHEMA_VERSION);
    infoTributaria(root, {
      issuer: invoice.issuer,
      accessKey: invoice.accessKey.value,
      documentType: invoice.documentType,
      sequential: invoice.sequential,
    });
    this.infoFactura(root.ele('infoFactura'), invoice);
    this.detalles(root.ele('detalles'), invoice);
    infoAdicional(root, invoice.additionalInfo);
    return root.end({ prettyPrint: false });
  }

  private infoFactura(node: XMLBuilder, invoice: Invoice): void {
    const { issuer, buyer, totals } = invoice;
    text(node, 'fechaEmision', invoice.emissionDate.toSriFormat());
    optional(node, 'dirEstablecimiento', issuer.establishmentAddress);
    optional(node, 'contribuyenteEspecial', issuer.specialTaxpayer);
    text(node, 'obligadoContabilidad', issuer.keepsAccounting ? 'SI' : 'NO');
    text(node, 'tipoIdentificacionComprador', buyer.idType);
    text(node, 'razonSocialComprador', buyer.name);
    text(node, 'identificacionComprador', buyer.id);
    optional(node, 'direccionComprador', buyer.address);
    text(node, 'totalSinImpuestos', formatMoney(totals.subtotal));
    text(node, 'totalDescuento', formatMoney(totals.totalDiscount));

    const taxes = node.ele('totalConImpuestos');
    for (const tax of totals.taxes) {
      const t = taxes.ele('totalImpuesto');
      text(t, 'codigo', tax.taxCode);
      text(t, 'codigoPorcentaje', tax.iva.code);
      text(t, 'baseImponible', formatMoney(tax.base));
      text(t, 'valor', formatMoney(tax.value));
    }
    text(node, 'propina', formatMoney(totals.tip));
    text(node, 'importeTotal', formatMoney(totals.total));
    text(node, 'moneda', 'DOLAR');

    const payments = node.ele('pagos');
    for (const payment of invoice.payments) {
      const p = payments.ele('pago');
      text(p, 'formaPago', payment.method);
      text(p, 'total', formatMoney(payment.amount));
      if (payment.term !== undefined) text(p, 'plazo', String(payment.term));
      optional(p, 'unidadTiempo', payment.timeUnit);
    }
  }

  private detalles(node: XMLBuilder, invoice: Invoice): void {
    for (const line of invoice.lines) {
      const d = node.ele('detalle');
      text(d, 'codigoPrincipal', line.code);
      optional(d, 'codigoAuxiliar', line.auxiliaryCode);
      text(d, 'descripcion', line.description);
      text(d, 'cantidad', formatDecimal(line.quantity));
      text(d, 'precioUnitario', formatDecimal(line.unitPrice));
      text(d, 'descuento', formatMoney(line.discount));
      text(d, 'precioTotalSinImpuesto', formatMoney(line.subtotal));
      const tax = d.ele('impuestos').ele('impuesto');
      text(tax, 'codigo', line.taxCode);
      text(tax, 'codigoPorcentaje', line.iva.code);
      text(tax, 'tarifa', formatDecimal(line.iva.rate, 2));
      text(tax, 'baseImponible', formatMoney(line.taxBase));
      text(tax, 'valor', formatMoney(line.taxValue));
    }
  }
}
