import { Schema, SchemaDefinition } from 'mongoose';
import { SriDocumentRecord, SriDocumentUpdate } from '../../application/ports/repositories';

/**
 * Campos de estado SRI que comparten todos los modelos de comprobantes (mismos nombres que
 * la colección de facturas, para que reportes y consultas sean homogéneos).
 */
export const sriDocumentFields: SchemaDefinition = {
  empresa_emisora_id: { type: Schema.Types.ObjectId, ref: 'IssuingCompany', required: true, index: true },
  numero: { type: String },
  ambiente: { type: String },
  fecha_emision: { type: Date, required: true },
  clave_acceso: { type: String, required: true, unique: true },
  secuencial: { type: String, required: true },
  estado: { type: String, required: true },
  sri_estado: { type: String },
  xml: { type: String },
  xml_firmado: { type: String },
  xml_autorizado: { type: String },
  autorizacion_numero: { type: String },
  fecha_autorizacion: { type: Date },
  sri_mensajes: { type: Schema.Types.Mixed },
  sri_fecha_envio: { type: Date },
  sri_fecha_respuesta: { type: Date },
  datos_originales: { type: String },
};

/** Persistido común de un comprobante (lo que lee {@link toSriDocumentRecord}). */
export interface SriDocumentDoc {
  _id: unknown;
  empresa_emisora_id: unknown;
  numero?: string;
  ambiente?: string;
  fecha_emision: Date;
  clave_acceso: string;
  secuencial: string;
  estado: string;
  sri_estado?: string;
  xml: string;
  xml_firmado?: string;
  xml_autorizado?: string;
  autorizacion_numero?: string;
  fecha_autorizacion?: Date;
  sri_mensajes?: unknown;
  sri_fecha_envio?: Date;
  sri_fecha_respuesta?: Date;
}

/** Campos a insertar para un comprobante nuevo. */
export function sriDocumentInsert(record: Omit<SriDocumentRecord, 'id'>, request?: unknown): Record<string, unknown> {
  return {
    empresa_emisora_id: record.issuerId,
    numero: record.number,
    ambiente: record.environment,
    fecha_emision: record.emissionDate,
    clave_acceso: record.accessKey,
    secuencial: record.sequential,
    estado: record.status,
    sri_estado: record.status,
    xml: record.xml,
    datos_originales: request === undefined ? undefined : JSON.stringify(request),
  };
}

/** Traduce un cambio de estado SRI a `$set` sobre el esquema en español. */
export function sriDocumentSet(changes: SriDocumentUpdate): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if (changes.status !== undefined) {
    set.estado = changes.status;
    set.sri_estado = changes.status;
  }
  if (changes.signedXml !== undefined) set.xml_firmado = changes.signedXml;
  if (changes.authorizedXml !== undefined) set.xml_autorizado = changes.authorizedXml;
  if (changes.authorizationNumber !== undefined) set.autorizacion_numero = changes.authorizationNumber;
  if (changes.authorizationDate !== undefined) set.fecha_autorizacion = changes.authorizationDate;
  if (changes.sentAt !== undefined) set.sri_fecha_envio = changes.sentAt;
  if (changes.respondedAt !== undefined) set.sri_fecha_respuesta = changes.respondedAt;
  if (changes.messages !== undefined) set.sri_mensajes = changes.messages;
  return set;
}

export function toSriDocumentRecord(doc: SriDocumentDoc, documentType: string): SriDocumentRecord {
  return {
    id: String(doc._id),
    issuerId: String(doc.empresa_emisora_id),
    documentType,
    accessKey: doc.clave_acceso,
    sequential: doc.secuencial,
    number: doc.numero ?? doc.secuencial,
    environment: doc.ambiente === '2' ? '2' : '1',
    emissionDate: doc.fecha_emision,
    status: doc.sri_estado ?? doc.estado,
    xml: doc.xml,
    signedXml: doc.xml_firmado || undefined,
    authorizedXml: doc.xml_autorizado || undefined,
    authorizationNumber: doc.autorizacion_numero || undefined,
    authorizationDate: doc.fecha_autorizacion || undefined,
    sentAt: doc.sri_fecha_envio,
    respondedAt: doc.sri_fecha_respuesta,
    messages: Array.isArray(doc.sri_mensajes) ? doc.sri_mensajes : undefined,
  };
}
