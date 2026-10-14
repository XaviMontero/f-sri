import { Model, Schema, Types, model, models } from 'mongoose';
import { NotFoundError } from '../../../domain/shared/errors';
import { SriDocumentUpdate } from '../../../application/ports/repositories';
import {
  SriDocumentDoc,
  sriDocumentFields,
  sriDocumentInsert,
  sriDocumentSet,
  toSriDocumentRecord,
} from '../../../infrastructure/persistence/sriDocumentMongo';
import { DebitNoteRecord, DebitNoteRepository, NewDebitNoteRecord } from '../application/DebitNoteRecord';
import { DOCUMENT_TYPE_DEBIT_NOTE } from '../domain/DebitNote';

export interface DebitNoteDoc extends SriDocumentDoc {
  cliente_id?: Types.ObjectId;
  comprador?: {
    tipo_identificacion?: string;
    identificacion?: string;
    razon_social?: string;
    direccion?: string;
    email?: string;
    telefono?: string;
  };
  cod_doc_modificado: string;
  num_doc_modificado: string;
  fecha_emision_doc_sustento: Date;
  total_sin_impuestos: number;
  total_impuestos: number;
  valor_total: number;
  motivos: Array<{ razon: string; valor: number; codigo_porcentaje_iva?: string }>;
  impuestos?: Array<{
    codigo: string;
    codigo_porcentaje: string;
    tarifa: number;
    base_imponible: number;
    valor: number;
  }>;
  pagos?: Array<{ forma_pago: string; total: number; plazo?: number; unidad_tiempo?: string }>;
  info_adicional?: Record<string, string>;
}

const schema = new Schema(
  {
    ...sriDocumentFields,
    cliente_id: { type: Schema.Types.ObjectId, ref: 'Client' },
    comprador: {
      tipo_identificacion: String,
      identificacion: String,
      razon_social: String,
      direccion: String,
      email: String,
      telefono: String,
    },
    cod_doc_modificado: { type: String, required: true },
    num_doc_modificado: { type: String, required: true },
    fecha_emision_doc_sustento: { type: Date, required: true },
    total_sin_impuestos: { type: Number, required: true },
    total_impuestos: { type: Number, required: true },
    valor_total: { type: Number, required: true },
    motivos: [
      {
        _id: false,
        razon: { type: String, required: true },
        valor: { type: Number, required: true },
        codigo_porcentaje_iva: String,
      },
    ],
    impuestos: [
      {
        _id: false,
        codigo: String,
        codigo_porcentaje: String,
        tarifa: Number,
        base_imponible: Number,
        valor: Number,
      },
    ],
    pagos: [{ _id: false, forma_pago: String, total: Number, plazo: Number, unidad_tiempo: String }],
    info_adicional: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

/** Colección `debitnotes` (mismo nombre que el modelo original del PR). */
export const DebitNoteModel: Model<DebitNoteDoc> =
  (models.DebitNote as Model<DebitNoteDoc>) ?? model<DebitNoteDoc>('DebitNote', schema);

export class MongoDebitNoteRepository implements DebitNoteRepository {
  async create(record: NewDebitNoteRecord): Promise<DebitNoteRecord> {
    const doc = await DebitNoteModel.create({
      ...sriDocumentInsert(record, record.request),
      cliente_id: record.buyerRecordId,
      comprador: {
        tipo_identificacion: record.buyer.idType,
        identificacion: record.buyer.id,
        razon_social: record.buyer.name,
        direccion: record.buyer.address,
        email: record.buyer.email,
        telefono: record.buyer.phone,
      },
      cod_doc_modificado: record.modifiedDocument.type,
      num_doc_modificado: record.modifiedDocument.number,
      fecha_emision_doc_sustento: record.modifiedDocument.emissionDate,
      total_sin_impuestos: record.subtotal,
      total_impuestos: record.totalTax,
      valor_total: record.total,
      motivos: record.reasons.map((r) => ({ razon: r.reason, valor: r.value, codigo_porcentaje_iva: r.ivaCode })),
      impuestos: record.taxes.map((t) => ({
        codigo: t.taxCode,
        codigo_porcentaje: t.ivaCode,
        tarifa: t.rate,
        base_imponible: t.base,
        valor: t.value,
      })),
      pagos: record.payments.map((p) => ({
        forma_pago: p.method,
        total: p.amount,
        plazo: p.term,
        unidad_tiempo: p.timeUnit,
      })),
      info_adicional: record.additionalInfo,
    });
    return toRecord(doc.toObject() as DebitNoteDoc);
  }

  async findById(id: string): Promise<DebitNoteRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await DebitNoteModel.findById(id).lean<DebitNoteDoc>();
    return doc ? toRecord(doc) : null;
  }

  async update(id: string, changes: SriDocumentUpdate): Promise<DebitNoteRecord> {
    const doc = await DebitNoteModel.findByIdAndUpdate(
      id,
      { $set: sriDocumentSet(changes) },
      { new: true },
    ).lean<DebitNoteDoc>();
    if (!doc) throw new NotFoundError('Nota de débito no encontrada');
    return toRecord(doc);
  }
}

function toRecord(doc: DebitNoteDoc): DebitNoteRecord {
  const buyer = doc.comprador;
  return {
    ...toSriDocumentRecord(doc, DOCUMENT_TYPE_DEBIT_NOTE),
    buyerRecordId: doc.cliente_id ? String(doc.cliente_id) : undefined,
    buyer: {
      idType: buyer?.tipo_identificacion ?? '',
      id: buyer?.identificacion ?? '',
      name: buyer?.razon_social ?? '',
      address: buyer?.direccion ?? undefined,
      email: buyer?.email ?? undefined,
      phone: buyer?.telefono ?? undefined,
    },
    modifiedDocument: {
      type: doc.cod_doc_modificado,
      number: doc.num_doc_modificado,
      emissionDate: doc.fecha_emision_doc_sustento,
    },
    reasons: (doc.motivos ?? []).map((m) => ({
      reason: m.razon,
      value: m.valor,
      ivaCode: m.codigo_porcentaje_iva ?? undefined,
    })),
    taxes: (doc.impuestos ?? []).map((t) => ({
      taxCode: t.codigo,
      ivaCode: t.codigo_porcentaje,
      rate: t.tarifa,
      base: t.base_imponible,
      value: t.valor,
    })),
    subtotal: doc.total_sin_impuestos,
    totalTax: doc.total_impuestos,
    total: doc.valor_total,
    payments: (doc.pagos ?? []).map((p) => ({
      method: p.forma_pago,
      amount: p.total,
      term: p.plazo ?? undefined,
      timeUnit: p.unidad_tiempo ?? undefined,
    })),
    additionalInfo: doc.info_adicional ?? undefined,
  };
}
