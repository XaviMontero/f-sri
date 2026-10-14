import { IssuerRecord } from '../../../application/ports/repositories';
import { formatMoney } from '../../../domain/shared/money';
import { DocumentRidePublisher } from '../../../infrastructure/ride/DocumentRidePublisher';
import { IPDFStorageProvider } from '../../../interfaces/pdf-storage.interface';
import { accessKeyBarcodeSvg, escapeHtml } from '../../../utils/pdf.utils';
import { WithholdingRecord } from '../application/ports';
import { RETENTION_TAXES } from '../domain/Withholding';
import { formatPercentage } from './WithholdingXmlRenderer';

/** Etiquetas de los tipos de documento de sustento más comunes (tabla 4 del catálogo ATS). */
const SUPPORT_DOCUMENT_LABELS: Record<string, string> = {
  '01': 'FACTURA',
  '02': 'NOTA DE VENTA',
  '03': 'LIQUIDACIÓN DE COMPRA',
  '04': 'NOTA DE CRÉDITO',
  '05': 'NOTA DE DÉBITO',
};

function formatDateTime(date: Date | undefined): string {
  if (!date) return '';
  const ec = new Date(new Date(date).getTime() - 5 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(ec.getUTCDate())}/${p(ec.getUTCMonth() + 1)}/${ec.getUTCFullYear()} ${p(ec.getUTCHours())}:${p(ec.getUTCMinutes())}:${p(ec.getUTCSeconds())}`;
}

/** Fecha de emisión: medianoche UTC del día civil. */
function formatEmissionDate(date: Date): string {
  const d = new Date(date);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function formatDocNumber(number?: string): string {
  return number && /^\d{15}$/.test(number) ? `${number.slice(0, 3)}-${number.slice(3, 6)}-${number.slice(6)}` : '';
}

/** HTML del RIDE del comprobante de retención (función pura, todo dato del cliente escapado). */
export function renderWithholdingRideHtml({
  document: w,
  issuer,
}: {
  document: WithholdingRecord;
  issuer: IssuerRecord;
}): string {
  const e = escapeHtml;
  const i = issuer.issuer;
  const rows = w.supportDocuments
    .flatMap((doc) =>
      doc.retentions.map(
        (
          r,
        ) => `<tr><td>${e(SUPPORT_DOCUMENT_LABELS[doc.documentType] ?? doc.documentType)} ${e(formatDocNumber(doc.number))}</td>
          <td>${e(doc.emissionDate)}</td><td>${e(w.fiscalPeriod)}</td>
          <td>${e(RETENTION_TAXES[r.taxCode] ?? r.taxCode)}</td><td>${e(r.retentionCode)}</td>
          <td class="num">${formatMoney(r.base)}</td><td class="num">${formatPercentage(r.percentage)}%</td>
          <td class="num">${formatMoney(r.value)}</td></tr>`,
      ),
    )
    .join('');
  const info = Object.entries(w.additionalInfo ?? {})
    .map(([name, value]) => `<tr><td class="label">${e(name)}</td><td>${e(value)}</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Comprobante de Retención ${e(w.number)}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; padding: 10px; line-height: 1.25; }
  .header { display: flex; gap: 10px; margin-bottom: 10px; }
  .box { border: 1px solid #000; border-radius: 6px; padding: 8px; }
  .company { flex: 1; }
  .doc { width: 48%; }
  .name { font-weight: bold; font-size: 12px; margin-bottom: 6px; }
  .key { font-family: 'Courier New', monospace; font-size: 9px; word-break: break-all; text-align: center; }
  .barcode svg { width: 100%; height: 40px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  td, th { border: 1px solid #000; padding: 3px 5px; font-size: 9px; }
  th, .label { background: #f0f0f0; font-weight: bold; }
  .num, .amount { text-align: right; }
  .totals { width: 45%; margin-left: auto; }
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
      <div class="name">COMPROBANTE DE RETENCIÓN</div>
      <div><strong>No.</strong> ${e(w.number)}</div>
      <div><strong>NÚMERO DE AUTORIZACIÓN</strong></div>
      <div class="key">${e(w.authorizationNumber ?? w.accessKey)}</div>
      <div><strong>FECHA Y HORA DE AUTORIZACIÓN:</strong> ${e(formatDateTime(w.authorizationDate))}</div>
      <div><strong>AMBIENTE:</strong> ${w.environment === '2' ? 'PRODUCCIÓN' : 'PRUEBAS'}</div>
      <div><strong>EMISIÓN:</strong> NORMAL</div>
      <div><strong>CLAVE DE ACCESO</strong></div>
      <div class="barcode">${accessKeyBarcodeSvg(w.accessKey)}</div>
      <div class="key">${e(w.accessKey)}</div>
    </div>
  </div>

  <table>
    <tr><td class="label">Razón Social / Nombres y Apellidos:</td><td>${e(w.subject.name)}</td>
        <td class="label">Identificación:</td><td>${e(w.subject.id)}</td></tr>
    <tr><td class="label">Fecha Emisión:</td><td>${e(formatEmissionDate(w.emissionDate))}</td>
        <td class="label">Período Fiscal:</td><td>${e(w.fiscalPeriod)}</td></tr>
  </table>

  <table>
    <thead><tr><th>Comprobante</th><th>Fecha Emisión</th><th>Ejercicio Fiscal</th><th>Impuesto</th>
      <th>Código Retención</th><th>Base Imponible</th><th>% Retención</th><th>Valor Retenido</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="totals"><tr><td class="label">TOTAL RETENIDO</td><td class="amount"><strong>$${formatMoney(w.totalWithheld)}</strong></td></tr></table>
  ${info ? `<table><tr><th colspan="2">Información Adicional</th></tr>${info}</table>` : ''}
</body></html>`;
}

/** Publicador del RIDE de retenciones sobre el publicador genérico (solo tras AUTORIZADO). */
export function withholdingRidePublisher(ride: {
  storage: () => IPDFStorageProvider;
  htmlToPdf: (html: string) => Promise<Buffer>;
}): DocumentRidePublisher<WithholdingRecord> {
  return new DocumentRidePublisher<WithholdingRecord>({
    storage: ride.storage,
    renderPdf: (data) => ride.htmlToPdf(renderWithholdingRideHtml(data)),
    filePrefix: 'retencion',
  });
}
