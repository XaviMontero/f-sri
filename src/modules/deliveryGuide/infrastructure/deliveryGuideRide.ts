import { IssuerRecord } from '../../../application/ports/repositories';
import { BUYER_ID_TYPES } from '../../../domain/invoice/catalogs';
import { formatDecimal } from '../../../domain/shared/money';
import { IPDFStorageProvider } from '../../../interfaces/pdf-storage.interface';
import { DocumentRidePublisher } from '../../../infrastructure/ride/DocumentRidePublisher';
import { accessKeyBarcodeSvg, escapeHtml } from '../../../utils/pdf.utils';
import { DeliveryGuideRecord } from '../application/ports';
import { MAX_QUANTITY_DECIMALS } from '../domain/DeliveryGuide';

/** Tipos de comprobante de sustento más comunes (tabla 3). */
const SUPPORTING_DOCUMENT_LABELS: Record<string, string> = {
  '01': 'FACTURA',
  '03': 'LIQUIDACIÓN DE COMPRA',
  '04': 'NOTA DE CRÉDITO',
  '05': 'NOTA DE DÉBITO',
  '07': 'COMPROBANTE DE RETENCIÓN',
};

/** Día civil guardado a medianoche UTC → dd/mm/aaaa (sin desplazar a UTC-5). */
function civilDate(date: Date | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

/** Instante → fecha y hora de Ecuador continental (UTC-5). */
function ecuadorDateTime(date: Date | undefined): string {
  if (!date) return '';
  const ec = new Date(new Date(date).getTime() - 5 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(ec.getUTCDate())}/${p(ec.getUTCMonth() + 1)}/${ec.getUTCFullYear()} ${p(ec.getUTCHours())}:${p(ec.getUTCMinutes())}:${p(ec.getUTCSeconds())}`;
}

/**
 * HTML del RIDE de la guía de remisión (sin valores monetarios: transporte y destinatarios).
 * Función pura; todo dato del cliente pasa por {@link escapeHtml}.
 */
export function renderDeliveryGuideRideHtml({
  document: g,
  issuer,
}: {
  document: DeliveryGuideRecord;
  issuer: IssuerRecord;
}): string {
  const e = escapeHtml;
  const i = issuer.issuer;

  const recipients = g.recipients
    .map((r) => {
      const support = r.supportingDocument;
      const supportRow =
        support && (support.number || support.type)
          ? `<tr><td class="label">Comprobante de venta</td><td>${e(
              SUPPORTING_DOCUMENT_LABELS[support.type ?? ''] ?? support.type ?? '',
            )} ${e(support.number ?? '')}</td>
            <td class="label">Fecha de emisión</td><td>${e(support.emissionDate ?? '')}</td></tr>
            ${support.authorizationNumber ? `<tr><td class="label">Número de autorización</td><td colspan="3" class="key">${e(support.authorizationNumber)}</td></tr>` : ''}`
          : '';
      const items = r.items
        .map(
          (item) =>
            `<tr><td class="num">${formatDecimal(item.quantity, MAX_QUANTITY_DECIMALS)}</td><td>${e(item.description)}</td><td>${e(item.internalCode ?? '')}</td><td>${e(item.additionalCode ?? '')}</td></tr>`,
        )
        .join('');
      return `<div class="recipient">
  <table>
    ${supportRow}
    <tr><td class="label">Motivo traslado</td><td colspan="3">${e(r.transferReason)}</td></tr>
    <tr><td class="label">Destinatario</td><td>${e(r.name)}</td><td class="label">Identificación</td><td>${e(r.id)}</td></tr>
    <tr><td class="label">Destino (punto de llegada)</td><td colspan="3">${e(r.address)}</td></tr>
    ${r.customsDocument ? `<tr><td class="label">Doc. aduanero</td><td colspan="3">${e(r.customsDocument)}</td></tr>` : ''}
    ${r.destinationEstablishment ? `<tr><td class="label">Cód. establecimiento destino</td><td colspan="3">${e(r.destinationEstablishment)}</td></tr>` : ''}
    ${r.route ? `<tr><td class="label">Ruta</td><td colspan="3">${e(r.route)}</td></tr>` : ''}
  </table>
  <table>
    <thead><tr><th>Cantidad</th><th>Descripción</th><th>Código principal</th><th>Código auxiliar</th></tr></thead>
    <tbody>${items}</tbody>
  </table>
</div>`;
    })
    .join('');

  const extra = Object.entries(g.additionalInfo ?? {});

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Guía de Remisión ${e(g.number)}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; padding: 10px; line-height: 1.25; }
  .header { display: flex; gap: 10px; margin-bottom: 10px; }
  .box { border: 1px solid #000; border-radius: 6px; padding: 8px; }
  .company { flex: 1; }
  .doc { width: 48%; }
  .name { font-weight: bold; font-size: 12px; margin-bottom: 6px; }
  .key { font-family: 'Courier New', monospace; font-size: 9px; word-break: break-all; }
  .barcode svg { width: 100%; height: 40px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  td, th { border: 1px solid #000; padding: 3px 5px; font-size: 9px; }
  th, .label { background: #f0f0f0; font-weight: bold; }
  .label { width: 150px; }
  .num { text-align: right; width: 80px; }
  .recipient { border: 1px solid #000; border-radius: 6px; padding: 6px; margin-bottom: 10px; }
</style></head>
<body>
  <div class="header">
    <div class="box company">
      <div class="name">${e(i.businessName)}</div>
      ${i.tradeName && i.tradeName !== i.businessName ? `<div>${e(i.tradeName)}</div>` : ''}
      <div><strong>Dirección Matriz:</strong> ${e(i.headOfficeAddress)}</div>
      ${i.establishmentAddress ? `<div><strong>Dirección Sucursal:</strong> ${e(i.establishmentAddress)}</div>` : ''}
      ${i.specialTaxpayer ? `<div><strong>Contribuyente Especial Nro:</strong> ${e(i.specialTaxpayer)}</div>` : ''}
      <div><strong>OBLIGADO A LLEVAR CONTABILIDAD:</strong> ${i.keepsAccounting ? 'SI' : 'NO'}</div>
    </div>
    <div class="box doc">
      <div><strong>R.U.C.:</strong> ${e(i.ruc)}</div>
      <div class="name">GUÍA DE REMISIÓN</div>
      <div><strong>No.</strong> ${e(g.number)}</div>
      <div><strong>NÚMERO DE AUTORIZACIÓN</strong></div>
      <div class="key">${e(g.authorizationNumber ?? g.accessKey)}</div>
      <div><strong>FECHA Y HORA DE AUTORIZACIÓN:</strong> ${e(ecuadorDateTime(g.authorizationDate))}</div>
      <div><strong>AMBIENTE:</strong> ${g.environment === '2' ? 'PRODUCCIÓN' : 'PRUEBAS'}</div>
      <div><strong>EMISIÓN:</strong> NORMAL</div>
      <div><strong>CLAVE DE ACCESO</strong></div>
      <div class="barcode">${accessKeyBarcodeSvg(g.accessKey)}</div>
      <div class="key">${e(g.accessKey)}</div>
    </div>
  </div>

  <table>
    <tr><td class="label">Identificación (Transportista)</td><td>${e(g.carrier.id)}</td>
        <td class="label">Tipo</td><td>${e(BUYER_ID_TYPES[g.carrier.idType] ?? g.carrier.idType)}</td></tr>
    <tr><td class="label">Razón Social / Nombres y Apellidos</td><td colspan="3">${e(g.carrier.name)}</td></tr>
    <tr><td class="label">Placa</td><td colspan="3">${e(g.plate)}</td></tr>
    <tr><td class="label">Punto de partida</td><td colspan="3">${e(g.departureAddress)}</td></tr>
    <tr><td class="label">Fecha inicio transporte</td><td>${e(civilDate(g.transportStart))}</td>
        <td class="label">Fecha fin transporte</td><td>${e(civilDate(g.transportEnd))}</td></tr>
  </table>

  ${recipients}

  ${
    extra.length
      ? `<table><tr><th colspan="2">Información Adicional</th></tr>${extra
          .map(([name, value]) => `<tr><td class="label">${e(name)}</td><td>${e(value)}</td></tr>`)
          .join('')}</table>`
      : ''
  }
</body></html>`;
}

/** Publicador del RIDE de guías autorizadas (lo invoca el pipeline común tras AUTORIZADO). */
export function deliveryGuideRidePublisher(ride: {
  storage: () => IPDFStorageProvider;
  htmlToPdf: (html: string) => Promise<Buffer>;
}): DocumentRidePublisher<DeliveryGuideRecord> {
  return new DocumentRidePublisher<DeliveryGuideRecord>({
    storage: ride.storage,
    filePrefix: 'guia_remision',
    renderPdf: (data) => ride.htmlToPdf(renderDeliveryGuideRideHtml(data)),
  });
}
