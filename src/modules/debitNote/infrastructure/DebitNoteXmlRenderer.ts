import { XMLBuilder } from 'xmlbuilder2/lib/interfaces';
import { formatDecimal, formatMoney } from '../../../domain/shared/money';
import { comprobanteRoot, infoAdicional, infoTributaria, optional, text } from '../../../infrastructure/sri/xmlHelpers';
import { DebitNoteXmlRenderer as DebitNoteXmlRendererPort } from '../application/DebitNoteRecord';
import { DebitNote } from '../domain/DebitNote';

/** Versión del esquema notaDebito (la que autorizó el SRI en pruebas). */
export const NOTA_DEBITO_SCHEMA_VERSION = '1.0.0';

/**
 * Serializa una {@link DebitNote} al XML `notaDebito` 1.0.0 de la ficha técnica del SRI:
 * infoTributaria, infoNotaDebito (sin detalles), motivos e infoAdicional, en el orden del XSD.
 */
export class DebitNoteXmlRenderer implements DebitNoteXmlRendererPort {
  render(note: DebitNote, numbering: { accessKey: string; sequential: string }): string {
    const root = comprobanteRoot('notaDebito', NOTA_DEBITO_SCHEMA_VERSION);
    infoTributaria(root, {
      issuer: note.issuer,
      accessKey: numbering.accessKey,
      documentType: note.documentType,
      sequential: numbering.sequential,
    });
    this.infoNotaDebito(root.ele('infoNotaDebito'), note);
    const motivos = root.ele('motivos');
    for (const r of note.reasons) {
      const m = motivos.ele('motivo');
      text(m, 'razon', r.reason);
      text(m, 'valor', formatMoney(r.value));
    }
    infoAdicional(root, note.additionalInfo);
    return root.end({ prettyPrint: false });
  }

  private infoNotaDebito(node: XMLBuilder, note: DebitNote): void {
    const { issuer, buyer, modifiedDocument } = note;
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
    text(node, 'totalSinImpuestos', formatMoney(note.subtotal));

    const taxes = node.ele('impuestos');
    for (const tax of note.taxes) {
      const t = taxes.ele('impuesto');
      text(t, 'codigo', tax.taxCode);
      text(t, 'codigoPorcentaje', tax.iva.code);
      text(t, 'tarifa', formatDecimal(tax.iva.rate, 2));
      text(t, 'baseImponible', formatMoney(tax.base));
      text(t, 'valor', formatMoney(tax.value));
    }
    text(node, 'valorTotal', formatMoney(note.total));

    const payments = node.ele('pagos');
    for (const payment of note.payments) {
      const p = payments.ele('pago');
      text(p, 'formaPago', payment.method);
      text(p, 'total', formatMoney(payment.amount));
      if (payment.term !== undefined) text(p, 'plazo', String(payment.term));
      optional(p, 'unidadTiempo', payment.timeUnit);
    }
  }
}
