import mongoose, { Model, Schema, model } from 'mongoose';
import { SriDocumentDoc, sriDocumentFields } from '../../../infrastructure/persistence/sriDocumentMongo';

export interface CreditNoteDetailDoc {
  producto_id?: unknown;
  codigo_interno: string;
  codigo_adicional?: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento: number;
  precio_total_sin_impuesto: number;
  codigo_porcentaje_iva: string;
  tarifa_iva: number;
  valor_iva: number;
}

export interface CreditNoteTaxDoc {
  codigo: string;
  codigo_porcentaje: string;
  tarifa: number;
  base_imponible: number;
  valor: number;
}

export interface CreditNoteDoc extends SriDocumentDoc {
  tipo_documento: string;
  cliente_id?: unknown;
  comprador: {
    tipo_identificacion: string;
    identificacion: string;
    razon_social: string;
    direccion?: string;
    email?: string;
    telefono?: string;
  };
  cod_doc_modificado: string;
  num_doc_modificado: string;
  fecha_emision_doc_sustento: Date;
  motivo: string;
  total_sin_impuestos: number;
  total_iva: number;
  valor_modificacion: number;
  impuestos: CreditNoteTaxDoc[];
  detalles: CreditNoteDetailDoc[];
  info_adicional?: Record<string, string>;
}

const detailSchema = new Schema<CreditNoteDetailDoc>(
  {
    producto_id: { type: Schema.Types.ObjectId, ref: 'Product' },
    codigo_interno: { type: String, required: true },
    codigo_adicional: { type: String },
    descripcion: { type: String, required: true },
    cantidad: { type: Number, required: true },
    precio_unitario: { type: Number, required: true },
    descuento: { type: Number, default: 0 },
    precio_total_sin_impuesto: { type: Number, required: true },
    codigo_porcentaje_iva: { type: String, required: true },
    tarifa_iva: { type: Number, required: true },
    valor_iva: { type: Number, required: true },
  },
  { _id: false },
);

const taxSchema = new Schema<CreditNoteTaxDoc>(
  {
    codigo: { type: String, required: true },
    codigo_porcentaje: { type: String, required: true },
    tarifa: { type: Number, required: true },
    base_imponible: { type: Number, required: true },
    valor: { type: Number, required: true },
  },
  { _id: false },
);

const schema = new Schema<CreditNoteDoc>(
  {
    ...sriDocumentFields,
    tipo_documento: { type: String, required: true, default: '04' },
    cliente_id: { type: Schema.Types.ObjectId, ref: 'Client' },
    comprador: {
      tipo_identificacion: { type: String, required: true },
      identificacion: { type: String, required: true },
      razon_social: { type: String, required: true },
      direccion: { type: String },
      email: { type: String },
      telefono: { type: String },
    },
    cod_doc_modificado: { type: String, required: true },
    num_doc_modificado: { type: String, required: true },
    fecha_emision_doc_sustento: { type: Date, required: true },
    motivo: { type: String, required: true },
    total_sin_impuestos: { type: Number, required: true },
    total_iva: { type: Number, required: true },
    valor_modificacion: { type: Number, required: true },
    impuestos: { type: [taxSchema], default: [] },
    detalles: { type: [detailSchema], default: [] },
    info_adicional: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

schema.index({ empresa_emisora_id: 1, num_doc_modificado: 1 });

/** Colección `creditnotes` (mismo nombre de modelo que la versión anterior). */
export const CreditNoteModel: Model<CreditNoteDoc> =
  (mongoose.models.CreditNote as Model<CreditNoteDoc> | undefined) ?? model<CreditNoteDoc>('CreditNote', schema);
