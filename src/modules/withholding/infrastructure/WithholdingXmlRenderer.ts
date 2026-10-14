import { XMLBuilder } from 'xmlbuilder2/lib/interfaces';
import { comprobanteRoot, infoAdicional, infoTributaria, optional, text } from '../../../infrastructure/sri/xmlHelpers';
import { formatMoney, round2 } from '../../../domain/shared/money';
import { WithholdingXmlRenderer as Renderer } from '../application/ports';
import { SupportDocument, Withholding } from '../domain/Withholding';

/** Versión del esquema: comprobante de retención ATS 2.0.0 (Anexo 10 de la ficha técnica). */
export const RETENCION_SCHEMA_VERSION = '2.0.0';

/** Porcentajes sin ceros de relleno ("15", "1.75"): la forma que el SRI autorizó en pruebas. */
export function formatPercentage(value: number): string {
  return String(round2(value));
}

/**
 * Serializa un {@link Withholding} al XML `comprobanteRetencion` 2.0.0. El orden de los elementos
 * es el del XSD y el del generador original verificado contra el SRI de pruebas:
 * `parteRel` se emite siempre (error 35 si falta) y el pago usa `<formaPago>` (camelCase).
 * No incluye los bloques de reembolsos, dividendos ni pagos al exterior.
 */
export class WithholdingXmlRenderer implements Renderer {
  render(withholding: Withholding, keys: { accessKey: string; sequential: string }): string {
    const root = comprobanteRoot('comprobanteRetencion', RETENCION_SCHEMA_VERSION);
    infoTributaria(root, {
      issuer: withholding.issuer,
      accessKey: keys.accessKey,
      documentType: withholding.documentType,
      sequential: keys.sequential,
    });
    this.infoCompRetencion(root.ele('infoCompRetencion'), withholding);
    const docs = root.ele('docsSustento');
    for (const doc of withholding.supportDocuments) this.docSustento(docs.ele('docSustento'), doc);
    infoAdicional(root, withholding.additionalInfo);
    return root.end({ prettyPrint: false });
  }

  private infoCompRetencion(node: XMLBuilder, withholding: Withholding): void {
    const { issuer, subject } = withholding;
    text(node, 'fechaEmision', withholding.emissionDate.toSriFormat());
    optional(node, 'dirEstablecimiento', issuer.establishmentAddress);
    optional(node, 'contribuyenteEspecial', issuer.specialTaxpayer);
    text(node, 'obligadoContabilidad', issuer.keepsAccounting ? 'SI' : 'NO');
    text(node, 'tipoIdentificacionSujetoRetenido', subject.idType);
    optional(node, 'tipoSujetoRetenido', subject.subjectType);
    text(node, 'parteRel', subject.relatedParty);
    text(node, 'razonSocialSujetoRetenido', subject.name);
    text(node, 'identificacionSujetoRetenido', subject.id);
    text(node, 'periodoFiscal', withholding.fiscalPeriod);
  }

  private docSustento(node: XMLBuilder, doc: SupportDocument): void {
    text(node, 'codSustento', doc.supportCode);
    text(node, 'codDocSustento', doc.documentType);
    optional(node, 'numDocSustento', doc.number);
    text(node, 'fechaEmisionDocSustento', doc.emissionDate);
    optional(node, 'fechaRegistroContable', doc.accountingDate);
    optional(node, 'numAutDocSustento', doc.authorizationNumber);
    text(node, 'pagoLocExt', doc.paymentLocation);
    text(node, 'totalSinImpuestos', formatMoney(doc.subtotal));
    text(node, 'importeTotal', formatMoney(doc.total));

    const taxes = node.ele('impuestosDocSustento');
    for (const tax of doc.taxes) {
      const t = taxes.ele('impuestoDocSustento');
      text(t, 'codImpuestoDocSustento', tax.taxCode);
      text(t, 'codigoPorcentaje', tax.rateCode);
      text(t, 'baseImponible', formatMoney(tax.base));
      text(t, 'tarifa', formatPercentage(tax.rate));
      text(t, 'valorImpuesto', formatMoney(tax.value));
    }

    const retentions = node.ele('retenciones');
    for (const r of doc.retentions) {
      const ret = retentions.ele('retencion');
      text(ret, 'codigo', r.taxCode);
      text(ret, 'codigoRetencion', r.retentionCode);
      text(ret, 'baseImponible', formatMoney(r.base));
      text(ret, 'porcentajeRetener', formatPercentage(r.percentage));
      text(ret, 'valorRetenido', formatMoney(r.value));
    }

    const payments = node.ele('pagos');
    for (const p of doc.payments) {
      const pago = payments.ele('pago');
      text(pago, 'formaPago', p.method);
      text(pago, 'total', formatMoney(p.amount));
    }
  }
}
