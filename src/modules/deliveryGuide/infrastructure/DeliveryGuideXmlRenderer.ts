import { XMLBuilder } from 'xmlbuilder2/lib/interfaces';
import { formatDecimal } from '../../../domain/shared/money';
import { comprobanteRoot, infoAdicional, infoTributaria, optional, text } from '../../../infrastructure/sri/xmlHelpers';
import { DeliveryGuide, DeliveryGuideRecipient, MAX_QUANTITY_DECIMALS } from '../domain/DeliveryGuide';

/** Versión del esquema `guiaRemision`: 1.1.0 admite hasta 6 decimales en cantidad. */
export const GUIA_REMISION_SCHEMA_VERSION = '1.1.0';

/**
 * Serializa una {@link DeliveryGuide} al XML `guiaRemision` 1.1.0 de la ficha técnica del SRI.
 * Mismo orden de elementos que el generador del aporte original (verificado AUTORIZADO en
 * el ambiente de pruebas del SRI); los opcionales vacíos se omiten.
 */
export class DeliveryGuideXmlRenderer {
  render(guide: DeliveryGuide): string {
    const root = comprobanteRoot('guiaRemision', GUIA_REMISION_SCHEMA_VERSION);
    infoTributaria(root, {
      issuer: guide.issuer,
      accessKey: guide.accessKey,
      documentType: guide.documentType,
      sequential: guide.sequential,
    });
    this.infoGuiaRemision(root.ele('infoGuiaRemision'), guide);
    const recipients = root.ele('destinatarios');
    for (const recipient of guide.recipients) this.destinatario(recipients.ele('destinatario'), recipient);
    infoAdicional(root, guide.additionalInfo);
    return root.end({ prettyPrint: false });
  }

  private infoGuiaRemision(node: XMLBuilder, guide: DeliveryGuide): void {
    const { issuer, carrier } = guide;
    text(node, 'dirEstablecimiento', issuer.establishmentAddress?.trim() || issuer.headOfficeAddress);
    text(node, 'dirPartida', guide.departureAddress);
    text(node, 'razonSocialTransportista', carrier.name);
    text(node, 'tipoIdentificacionTransportista', carrier.idType);
    text(node, 'rucTransportista', carrier.id);
    text(node, 'obligadoContabilidad', issuer.keepsAccounting ? 'SI' : 'NO');
    optional(node, 'contribuyenteEspecial', issuer.specialTaxpayer);
    text(node, 'fechaIniTransporte', guide.transportStart.toSriFormat());
    text(node, 'fechaFinTransporte', guide.transportEnd.toSriFormat());
    text(node, 'placa', guide.plate);
  }

  private destinatario(node: XMLBuilder, r: DeliveryGuideRecipient): void {
    text(node, 'identificacionDestinatario', r.id);
    text(node, 'razonSocialDestinatario', r.name);
    text(node, 'dirDestinatario', r.address);
    text(node, 'motivoTraslado', r.transferReason);
    optional(node, 'docAduaneroUnico', r.customsDocument);
    optional(node, 'codEstabDestino', r.destinationEstablishment);
    optional(node, 'ruta', r.route);
    optional(node, 'codDocSustento', r.supportingDocument?.type);
    optional(node, 'numDocSustento', r.supportingDocument?.number);
    optional(node, 'numAutDocSustento', r.supportingDocument?.authorizationNumber);
    optional(node, 'fechaEmisionDocSustento', r.supportingDocument?.emissionDate);

    const details = node.ele('detalles');
    for (const item of r.items) {
      const d = details.ele('detalle');
      optional(d, 'codigoInterno', item.internalCode);
      optional(d, 'codigoAdicional', item.additionalCode);
      text(d, 'descripcion', item.description);
      text(d, 'cantidad', formatDecimal(item.quantity, MAX_QUANTITY_DECIMALS));
    }
  }
}
