import { XMLBuilder } from 'xmlbuilder2/lib/interfaces';
import { formatDecimal, formatMoney } from '../../../domain/shared/money';
import { comprobanteRoot, infoAdicional, infoTributaria, optional, text } from '../../../infrastructure/sri/xmlHelpers';
import { CreditNoteXmlRenderer as CreditNoteXmlRendererPort } from '../application/IssueCreditNote';
import { CreditNote } from '../domain/CreditNote';

/** Versión del esquema `notaCredito` (admite 6 decimales en cantidad y precio unitario). */
export const NOTA_CREDITO_SCHEMA_VERSION = '1.1.0';

/**
 * Serializa una {@link CreditNote} al XML `notaCredito` 1.1.0 de la ficha técnica del SRI, con
 * el orden de elementos del XSD (el mismo del generador original autorizado por el SRI):
 *
 * infoNotaCredito: fechaEmision, dirEstablecimiento?, tipoIdentificacionComprador,
 * razonSocialComprador, identificacionComprador, contribuyenteEspecial?, obligadoContabilidad,
 * codDocModificado, numDocModificado, fechaEmisionDocSustento, totalSinImpuestos,
 * valorModificacion, moneda, totalConImpuestos, motivo.
 *
 * `totalConImpuestos` lleva un `totalImpuesto` por cada (codigo, codigoPorcentaje).
 */
export class CreditNoteXmlRenderer implements CreditNoteXmlRendererPort {
  render(note: CreditNote): string {
    const root = comprobanteRoot('notaCredito', NOTA_CREDITO_SCHEMA_VERSION);
    infoTributaria(root, {
      issuer: note.issuer,
      accessKey: note.accessKey.value,
      documentType: note.documentType,
      sequential: note.sequential,
    });
    this.infoNotaCredito(root.ele('infoNotaCredito'), note);
    this.detalles(root.ele('detalles'), note);
    infoAdicional(root, note.additionalInfo);
    return root.end({ prettyPrint: false });
  }

  private infoNotaCredito(node: XMLBuilder, note: CreditNote): void {
    const { issuer, buyer, totals, modifiedDocument } = note;
    text(node, 'fechaEmision', note.emissionDate.toSriFormat());
    optional(node, 'dirEstablecimiento', issuer.establishmentAddress);
    text(node, 'tipoIdentificacionComprador', buyer.idType);
    text(node, 'razonSocialComprador', buyer.name);
    text(node, 'identificacionComprador', buyer.id);
    optional(node, 'contribuyenteEspecial', issuer.specialTaxpayer);
    text(node, 'obligadoContabilidad', issuer.keepsAccounting ? 'SI' : 'NO');
    text(node, 'codDocModificado', modifiedDocument.type);
    text(node, 'numDocModificado', modifiedDocument.number);
    text(node, 'fechaEmisionDocSustento', modifiedDocument.emissionDate.toSriFormat());
    text(node, 'totalSinImpuestos', formatMoney(totals.subtotal));
    text(node, 'valorModificacion', formatMoney(note.modificationValue));
    text(node, 'moneda', 'DOLAR');

    const taxes = node.ele('totalConImpuestos');
    for (const tax of totals.taxes) {
      const t = taxes.ele('totalImpuesto');
      text(t, 'codigo', tax.taxCode);
      text(t, 'codigoPorcentaje', tax.iva.code);
      text(t, 'baseImponible', formatMoney(tax.base));
      text(t, 'valor', formatMoney(tax.value));
    }
    text(node, 'motivo', note.reason);
  }

  private detalles(node: XMLBuilder, note: CreditNote): void {
    for (const line of note.lines) {
      const d = node.ele('detalle');
      text(d, 'codigoInterno', line.code);
      optional(d, 'codigoAdicional', line.auxiliaryCode);
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
