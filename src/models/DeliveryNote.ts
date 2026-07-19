import { Schema, model, Document, Types } from 'mongoose';

export interface IDeliveryNote extends Document {
  empresa_emisora_id: Types.ObjectId;
  fecha_emision: Date;
  clave_acceso: string;
  secuencial: string;
  estado: string;
  dir_partida: string;
  razon_social_transportista: string;
  tipo_identificacion_transportista: string;
  ruc_transportista: string;
  fecha_ini_transporte: Date;
  fecha_fin_transporte: Date;
  placa: string;
  destinatarios: any[];
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

const schema = new Schema<IDeliveryNote>({
  empresa_emisora_id: { type: Schema.Types.ObjectId, ref: 'IssuingCompany', required: true },
  fecha_emision: { type: Date, required: true },
  clave_acceso: { type: String, required: true },
  secuencial: { type: String, required: true },
  estado: { type: String, required: true },
  dir_partida: { type: String, required: true },
  razon_social_transportista: { type: String, required: true },
  tipo_identificacion_transportista: { type: String, required: true },
  ruc_transportista: { type: String, required: true },
  fecha_ini_transporte: { type: Date, required: true },
  fecha_fin_transporte: { type: Date, required: true },
  placa: { type: String, required: true },
  destinatarios: { type: Schema.Types.Mixed, required: true },
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

export default model<IDeliveryNote>('DeliveryNote', schema);
