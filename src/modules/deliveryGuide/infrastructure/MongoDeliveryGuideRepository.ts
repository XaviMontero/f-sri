import { Model, Schema, Types, model, models } from 'mongoose';
import { SriDocumentUpdate } from '../../../application/ports/repositories';
import { NotFoundError } from '../../../domain/shared/errors';
import {
  SriDocumentDoc,
  sriDocumentFields,
  sriDocumentInsert,
  sriDocumentSet,
  toSriDocumentRecord,
} from '../../../infrastructure/persistence/sriDocumentMongo';
import { DeliveryGuideRecord, DeliveryGuideRepository, NewDeliveryGuideRecord } from '../application/ports';
import { DOCUMENT_TYPE_GUIA_REMISION, DeliveryGuideRecipient } from '../domain/DeliveryGuide';

/** Destinatario persistido con los nombres de la ficha técnica (como lo guardaba el aporte original). */
interface StoredRecipient {
  identificacionDestinatario: string;
  razonSocialDestinatario: string;
  dirDestinatario: string;
  motivoTraslado: string;
  docAduaneroUnico?: string;
  codEstabDestino?: string;
  ruta?: string;
  codDocSustento?: string;
  numDocSustento?: string;
  numAutDocSustento?: string;
  fechaEmisionDocSustento?: string;
  detalles: Array<{ codigoInterno?: string; codigoAdicional?: string; descripcion: string; cantidad: number }>;
}

export interface IDeliveryNote extends SriDocumentDoc {
  dir_partida: string;
  razon_social_transportista: string;
  tipo_identificacion_transportista: string;
  ruc_transportista: string;
  fecha_ini_transporte: Date;
  fecha_fin_transporte: Date;
  placa: string;
  destinatarios: StoredRecipient[];
  info_adicional?: Record<string, string>;
}

const schema = new Schema(
  {
    ...sriDocumentFields,
    dir_partida: { type: String, required: true },
    razon_social_transportista: { type: String, required: true },
    tipo_identificacion_transportista: { type: String, required: true },
    ruc_transportista: { type: String, required: true },
    fecha_ini_transporte: { type: Date, required: true },
    fecha_fin_transporte: { type: Date, required: true },
    placa: { type: String, required: true },
    destinatarios: { type: Schema.Types.Mixed, required: true },
    info_adicional: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

/** Colección de guías de remisión (mismo nombre de modelo que el aporte original). */
export const DeliveryNoteModel: Model<IDeliveryNote> =
  (models.DeliveryNote as Model<IDeliveryNote> | undefined) ?? model<IDeliveryNote>('DeliveryNote', schema);

export class MongoDeliveryGuideRepository implements DeliveryGuideRepository {
  async create(record: NewDeliveryGuideRecord): Promise<DeliveryGuideRecord> {
    const doc = await DeliveryNoteModel.create({
      ...sriDocumentInsert(record, record.request),
      dir_partida: record.departureAddress,
      razon_social_transportista: record.carrier.name,
      tipo_identificacion_transportista: record.carrier.idType,
      ruc_transportista: record.carrier.id,
      fecha_ini_transporte: record.transportStart,
      fecha_fin_transporte: record.transportEnd,
      placa: record.plate,
      destinatarios: record.recipients.map(toStoredRecipient),
      info_adicional: record.additionalInfo,
    });
    return toRecord(doc.toObject() as IDeliveryNote);
  }

  async findById(id: string): Promise<DeliveryGuideRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await DeliveryNoteModel.findById(id).lean<IDeliveryNote>();
    return doc ? toRecord(doc) : null;
  }

  async update(id: string, changes: SriDocumentUpdate): Promise<DeliveryGuideRecord> {
    const doc = await DeliveryNoteModel.findByIdAndUpdate(
      id,
      { $set: sriDocumentSet(changes) },
      { new: true },
    ).lean<IDeliveryNote>();
    if (!doc) throw new NotFoundError('Guía de remisión no encontrada');
    return toRecord(doc);
  }
}

function toStoredRecipient(r: DeliveryGuideRecipient): StoredRecipient {
  return {
    identificacionDestinatario: r.id,
    razonSocialDestinatario: r.name,
    dirDestinatario: r.address,
    motivoTraslado: r.transferReason,
    docAduaneroUnico: r.customsDocument,
    codEstabDestino: r.destinationEstablishment,
    ruta: r.route,
    codDocSustento: r.supportingDocument?.type,
    numDocSustento: r.supportingDocument?.number,
    numAutDocSustento: r.supportingDocument?.authorizationNumber,
    fechaEmisionDocSustento: r.supportingDocument?.emissionDate,
    detalles: r.items.map((i) => ({
      codigoInterno: i.internalCode,
      codigoAdicional: i.additionalCode,
      descripcion: i.description,
      cantidad: i.quantity,
    })),
  };
}

function fromStoredRecipient(r: StoredRecipient): DeliveryGuideRecipient {
  const hasSupport = r.codDocSustento || r.numDocSustento || r.numAutDocSustento || r.fechaEmisionDocSustento;
  return {
    id: r.identificacionDestinatario,
    name: r.razonSocialDestinatario,
    address: r.dirDestinatario,
    transferReason: r.motivoTraslado,
    customsDocument: r.docAduaneroUnico ?? undefined,
    destinationEstablishment: r.codEstabDestino ?? undefined,
    route: r.ruta ?? undefined,
    supportingDocument: hasSupport
      ? {
          type: r.codDocSustento ?? undefined,
          number: r.numDocSustento ?? undefined,
          authorizationNumber: r.numAutDocSustento ?? undefined,
          emissionDate: r.fechaEmisionDocSustento ?? undefined,
        }
      : undefined,
    items: (r.detalles ?? []).map((d) => ({
      internalCode: d.codigoInterno ?? undefined,
      additionalCode: d.codigoAdicional ?? undefined,
      description: d.descripcion,
      quantity: Number(d.cantidad),
    })),
  };
}

function toRecord(doc: IDeliveryNote): DeliveryGuideRecord {
  return {
    ...toSriDocumentRecord(doc, DOCUMENT_TYPE_GUIA_REMISION),
    departureAddress: doc.dir_partida,
    carrier: {
      idType: doc.tipo_identificacion_transportista,
      id: doc.ruc_transportista,
      name: doc.razon_social_transportista,
    },
    transportStart: doc.fecha_ini_transporte,
    transportEnd: doc.fecha_fin_transporte,
    plate: doc.placa,
    recipients: Array.isArray(doc.destinatarios) ? doc.destinatarios.map(fromStoredRecipient) : [],
    additionalInfo: doc.info_adicional ?? undefined,
  };
}
