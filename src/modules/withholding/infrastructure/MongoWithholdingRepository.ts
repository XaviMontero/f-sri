import mongoose, { Model, Schema, Types, model } from 'mongoose';
import { NotFoundError } from '../../../domain/shared/errors';
import {
  SriDocumentDoc,
  sriDocumentFields,
  sriDocumentInsert,
  sriDocumentSet,
  toSriDocumentRecord,
} from '../../../infrastructure/persistence/sriDocumentMongo';
import { SriDocumentUpdate } from '../../../application/ports/repositories';
import { NewWithholdingRecord, WithholdingRecord, WithholdingRepository } from '../application/ports';
import { DOCUMENT_TYPE_RETENCION, SupportDocument, WithholdingSubject } from '../domain/Withholding';

/** Documento de sustento persistido con los nombres de la ficha técnica (importes numéricos). */
interface DocSustentoDoc {
  codSustento: string;
  codDocSustento: string;
  numDocSustento?: string;
  fechaEmisionDocSustento: string;
  fechaRegistroContable?: string;
  numAutDocSustento?: string;
  pagoLocExt: string;
  totalSinImpuestos: number;
  importeTotal: number;
  impuestos: Array<{
    codImpuestoDocSustento: string;
    codigoPorcentaje: string;
    baseImponible: number;
    tarifa: number;
    valorImpuesto: number;
  }>;
  retenciones: Array<{
    codigo: string;
    codigoRetencion: string;
    baseImponible: number;
    porcentajeRetener: number;
    valorRetenido: number;
  }>;
  pagos: Array<{ formaPago: string; total: number }>;
}

export interface IWithholding extends SriDocumentDoc {
  tipo_identificacion_sujeto_retenido: string;
  identificacion_sujeto_retenido: string;
  razon_social_sujeto_retenido: string;
  tipo_sujeto_retenido?: string;
  parte_rel?: string;
  periodo_fiscal: string;
  total_retenido: number;
  docs_sustento: DocSustentoDoc[];
  info_adicional?: Record<string, string>;
}

const schema = new Schema(
  {
    ...sriDocumentFields,
    tipo_identificacion_sujeto_retenido: { type: String, required: true },
    identificacion_sujeto_retenido: { type: String, required: true },
    razon_social_sujeto_retenido: { type: String, required: true },
    tipo_sujeto_retenido: { type: String },
    parte_rel: { type: String },
    periodo_fiscal: { type: String, required: true },
    total_retenido: { type: Number, required: true },
    docs_sustento: { type: Schema.Types.Mixed, required: true },
    info_adicional: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

/** Colección `withholdings` (comprobantes de retención). */
export const WithholdingModel: Model<IWithholding> =
  (mongoose.models.Withholding as Model<IWithholding>) ?? model<IWithholding>('Withholding', schema);

export class MongoWithholdingRepository implements WithholdingRepository {
  async create(record: NewWithholdingRecord): Promise<WithholdingRecord> {
    const doc = await WithholdingModel.create({
      ...sriDocumentInsert(record, record.request),
      tipo_identificacion_sujeto_retenido: record.subject.idType,
      identificacion_sujeto_retenido: record.subject.id,
      razon_social_sujeto_retenido: record.subject.name,
      tipo_sujeto_retenido: record.subject.subjectType,
      parte_rel: record.subject.relatedParty,
      periodo_fiscal: record.fiscalPeriod,
      total_retenido: record.totalWithheld,
      docs_sustento: record.supportDocuments.map(toDocSustento),
      info_adicional: record.additionalInfo,
    });
    return toRecord(doc.toObject() as IWithholding);
  }

  async findById(id: string): Promise<WithholdingRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await WithholdingModel.findById(id).lean<IWithholding>();
    return doc ? toRecord(doc) : null;
  }

  async update(id: string, changes: SriDocumentUpdate): Promise<WithholdingRecord> {
    const doc = await WithholdingModel.findByIdAndUpdate(
      id,
      { $set: sriDocumentSet(changes) },
      { new: true },
    ).lean<IWithholding>();
    if (!doc) throw new NotFoundError('Retención no encontrada');
    return toRecord(doc);
  }
}

function toRecord(doc: IWithholding): WithholdingRecord {
  const subject: WithholdingSubject = {
    idType: doc.tipo_identificacion_sujeto_retenido,
    id: doc.identificacion_sujeto_retenido,
    name: doc.razon_social_sujeto_retenido,
    subjectType: doc.tipo_sujeto_retenido || undefined,
    relatedParty: doc.parte_rel === 'SI' ? 'SI' : 'NO',
  };
  return {
    ...toSriDocumentRecord(doc, DOCUMENT_TYPE_RETENCION),
    subject,
    fiscalPeriod: doc.periodo_fiscal,
    totalWithheld: doc.total_retenido,
    supportDocuments: (doc.docs_sustento ?? []).map(fromDocSustento),
    additionalInfo: doc.info_adicional,
  };
}

function toDocSustento(d: SupportDocument): DocSustentoDoc {
  return {
    codSustento: d.supportCode,
    codDocSustento: d.documentType,
    numDocSustento: d.number,
    fechaEmisionDocSustento: d.emissionDate,
    fechaRegistroContable: d.accountingDate,
    numAutDocSustento: d.authorizationNumber,
    pagoLocExt: d.paymentLocation,
    totalSinImpuestos: d.subtotal,
    importeTotal: d.total,
    impuestos: d.taxes.map((t) => ({
      codImpuestoDocSustento: t.taxCode,
      codigoPorcentaje: t.rateCode,
      baseImponible: t.base,
      tarifa: t.rate,
      valorImpuesto: t.value,
    })),
    retenciones: d.retentions.map((r) => ({
      codigo: r.taxCode,
      codigoRetencion: r.retentionCode,
      baseImponible: r.base,
      porcentajeRetener: r.percentage,
      valorRetenido: r.value,
    })),
    pagos: d.payments.map((p) => ({ formaPago: p.method, total: p.amount })),
  };
}

function fromDocSustento(d: DocSustentoDoc): SupportDocument {
  return {
    supportCode: d.codSustento,
    documentType: d.codDocSustento,
    number: d.numDocSustento ?? undefined,
    emissionDate: d.fechaEmisionDocSustento,
    accountingDate: d.fechaRegistroContable ?? undefined,
    authorizationNumber: d.numAutDocSustento ?? undefined,
    paymentLocation: d.pagoLocExt,
    subtotal: d.totalSinImpuestos,
    total: d.importeTotal,
    taxes: (d.impuestos ?? []).map((t) => ({
      taxCode: t.codImpuestoDocSustento,
      rateCode: t.codigoPorcentaje,
      base: t.baseImponible,
      rate: t.tarifa,
      value: t.valorImpuesto,
    })),
    retentions: (d.retenciones ?? []).map((r) => ({
      taxCode: r.codigo,
      retentionCode: r.codigoRetencion,
      base: r.baseImponible,
      percentage: r.porcentajeRetener,
      value: r.valorRetenido,
    })),
    payments: (d.pagos ?? []).map((p) => ({ method: p.formaPago, amount: p.total })),
  };
}
