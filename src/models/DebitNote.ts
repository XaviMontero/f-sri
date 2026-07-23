import { Schema, model, Document, Types } from 'mongoose';

export interface IDebitNote extends Document {
  empresa_emisora_id: Types.ObjectId;
  cliente_id: Types.ObjectId;
  factura_modificada_id?: Types.ObjectId;
  fecha_emision: Date;
  clave_acceso: string;
  secuencial: string;
  estado: string;
  cod_doc_modificado: string;
  num_doc_modificado: string;
  fecha_emision_doc_sustento: Date;
  total_sin_impuestos: number;
  total_impuestos: number;
  valor_total: number;
  motivos: Array<{ razon: string; valor: number }>;
  xml: string;
  xml_firmado: string;
  autorizacion_numero: string;
  fecha_autorizacion: Date;
  sri_estado?: string;
  sri_mensajes?: any;
  sri_fecha_envio?: Date;
  sri_fecha_respuesta?: Date;
  datos_originales?: string;
}

const schema = new Schema<IDebitNote>({
  empresa_emisora_id: { type: Schema.Types.ObjectId, ref: 'IssuingCompany', required: true },
  cliente_id: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  factura_modificada_id: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  fecha_emision: { type: Date, required: true },
  clave_acceso: { type: String, required: true },
  secuencial: { type: String, required: true },
  estado: { type: String, required: true },
  cod_doc_modificado: { type: String, required: true },
  num_doc_modificado: { type: String, required: true },
  fecha_emision_doc_sustento: { type: Date, required: true },
  total_sin_impuestos: { type: Number, required: true },
  total_impuestos: { type: Number, required: true },
  valor_total: { type: Number, required: true },
  motivos: [
    {
      razon: { type: String, required: true },
      valor: { type: Number, required: true },
    },
  ],
  xml: { type: String },
  xml_firmado: { type: String },
  autorizacion_numero: { type: String },
  fecha_autorizacion: { type: Date },
  sri_estado: { type: String },
  sri_mensajes: { type: Schema.Types.Mixed },
  sri_fecha_envio: { type: Date },
  sri_fecha_respuesta: { type: Date },
  datos_originales: { type: String },
});

export default model<IDebitNote>('DebitNote', schema);
