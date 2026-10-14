import { ValidationError } from '../../../domain/shared/errors';
import { parseAmount } from '../../../domain/shared/money';
import { IssueDeliveryGuideCommand } from '../application/IssueDeliveryGuide';
import { DeliveryGuideItem, DeliveryGuideRecipient } from '../domain/DeliveryGuide';

const str = (value: unknown): string | undefined =>
  value === undefined || value === null || value === '' ? undefined : String(value);

/**
 * Traduce el payload público `{ guia_remision: {...} }` (nombres de la ficha técnica del SRI,
 * igual que el aporte original) al comando del caso de uso. Acepta destinatarios y detalles
 * envueltos (`{ destinatario: {...} }`, `{ detalle: {...} }`) o planos.
 */
export function toIssueDeliveryGuideCommand(guia: any): IssueDeliveryGuideCommand {
  if (!guia || typeof guia !== 'object') throw new ValidationError('Delivery note data is required');
  const { infoTributaria, infoGuiaRemision: info, destinatarios } = guia;
  if (!infoTributaria?.ruc || !info || typeof info !== 'object') {
    throw new ValidationError('Datos de guía de remisión inválidos o incompletos');
  }
  if (!Array.isArray(destinatarios) || !destinatarios.length) {
    throw new ValidationError('La guía de remisión debe tener al menos un destinatario');
  }
  for (const field of ['fechaIniTransporte', 'fechaFinTransporte', 'tipoIdentificacionTransportista']) {
    if (!info[field]) throw new ValidationError(`${field} es requerido`);
  }

  return {
    issuerRuc: String(infoTributaria.ruc),
    emissionDate: str(info.fechaEmision),
    departureAddress: info.dirPartida,
    carrier: {
      idType: String(info.tipoIdentificacionTransportista),
      id: str(info.rucTransportista) ?? '',
      name: info.razonSocialTransportista,
    },
    transportStart: String(info.fechaIniTransporte),
    transportEnd: String(info.fechaFinTransporte),
    plate: info.placa,
    recipients: destinatarios.map((item: any, index: number) => toRecipient(item?.destinatario ?? item, index + 1)),
    additionalInfo: toAdditionalInfo(guia.infoAdicional),
  };
}

function toRecipient(d: any, position: number): DeliveryGuideRecipient {
  if (!d || typeof d !== 'object') throw new ValidationError(`El destinatario ${position} es requerido`);
  if (!Array.isArray(d.detalles) || !d.detalles.length) {
    throw new ValidationError(`El destinatario ${position} debe tener al menos un detalle`);
  }
  const supporting = {
    type: str(d.codDocSustento),
    number: str(d.numDocSustento),
    authorizationNumber: str(d.numAutDocSustento),
    emissionDate: str(d.fechaEmisionDocSustento),
  };
  return {
    id: str(d.identificacionDestinatario) ?? '',
    name: d.razonSocialDestinatario,
    address: d.dirDestinatario,
    transferReason: d.motivoTraslado,
    customsDocument: str(d.docAduaneroUnico),
    destinationEstablishment: str(d.codEstabDestino),
    route: str(d.ruta),
    supportingDocument: Object.values(supporting).some(Boolean) ? supporting : undefined,
    items: d.detalles.map((item: any, i: number) =>
      toItem(item?.detalle ?? item, `detalle ${i + 1} del destinatario ${position}`),
    ),
  };
}

function toItem(d: any, label: string): DeliveryGuideItem {
  if (!d || typeof d !== 'object') throw new ValidationError(`El ${label} es requerido`);
  let quantity: number;
  try {
    quantity = parseAmount(d.cantidad, `cantidad del ${label}`);
  } catch (error) {
    throw new ValidationError((error as Error).message);
  }
  return {
    internalCode: str(d.codigoInterno),
    additionalCode: str(d.codigoAdicional),
    description: d.descripcion,
    quantity,
  };
}

/** `infoAdicional` como objeto `{ nombre: valor }` o como lista `[{ nombre, valor }]`. */
function toAdditionalInfo(input: unknown): Record<string, string> | undefined {
  if (!input) return undefined;
  if (Array.isArray(input)) {
    return Object.fromEntries(
      input
        .map((c: any) => c?.campoAdicional ?? c)
        .filter((c: any) => c && c.nombre)
        .map((c: any) => [String(c.nombre), String(c.valor ?? c.value ?? '')]),
    );
  }
  if (typeof input === 'object') {
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]));
  }
  throw new ValidationError('infoAdicional debe ser un objeto { nombre: valor }');
}
