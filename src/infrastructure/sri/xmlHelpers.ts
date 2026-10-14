import { create } from 'xmlbuilder2';
import { XMLBuilder } from 'xmlbuilder2/lib/interfaces';
import { Issuer } from '../../domain/invoice/Invoice';
import { COMPROBANTE_ID } from '../../domain/sri/constants';

/** Nodo raíz de un comprobante: `<codigo id="comprobante" version="...">`, que es lo que firma XAdES. */
export function comprobanteRoot(element: string, version: string): XMLBuilder {
  return create({ version: '1.0', encoding: 'UTF-8' }).ele(element, { id: COMPROBANTE_ID, version });
}

export function text(node: XMLBuilder, name: string, value: string): void {
  node.ele(name).txt(value);
}

/** Omite opcionales vacíos: el XSD del SRI rechaza elementos sin contenido. */
export function optional(node: XMLBuilder, name: string, value?: string | null): void {
  if (value !== undefined && value !== null && String(value).trim() !== '') text(node, name, String(value).trim());
}

export interface InfoTributaria {
  issuer: Issuer;
  accessKey: string;
  documentType: string;
  sequential: string;
}

/** Bloque `infoTributaria`, idéntico en los cinco comprobantes (orden del XSD). */
export function infoTributaria(root: XMLBuilder, data: InfoTributaria): void {
  const node = root.ele('infoTributaria');
  const { issuer } = data;
  text(node, 'ambiente', issuer.environment);
  text(node, 'tipoEmision', issuer.emissionType);
  text(node, 'razonSocial', issuer.businessName);
  optional(node, 'nombreComercial', issuer.tradeName);
  text(node, 'ruc', issuer.ruc);
  text(node, 'claveAcceso', data.accessKey);
  text(node, 'codDoc', data.documentType);
  text(node, 'estab', issuer.establishment);
  text(node, 'ptoEmi', issuer.emissionPoint);
  text(node, 'secuencial', data.sequential);
  text(node, 'dirMatriz', issuer.headOfficeAddress);
}

/** Bloque `infoAdicional` (máximo 15 campos, sin vacíos). */
export function infoAdicional(root: XMLBuilder, info: Record<string, string> | undefined): void {
  const entries = Object.entries(info ?? {}).filter(([k, v]) => k.trim() && String(v ?? '').trim());
  if (!entries.length) return;
  const node = root.ele('infoAdicional');
  for (const [name, value] of entries) node.ele('campoAdicional', { nombre: name }).txt(String(value).trim());
}
