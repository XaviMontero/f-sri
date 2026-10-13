import { Schema, model, Document, Types } from 'mongoose';

export interface IInvoice extends Document {
  empresa_emisora_id: Types.ObjectId;
  cliente_id?: Types.ObjectId;
  comprador?: {
    tipo_identificacion: string;
    identificacion: string;
    razon_social: string;
    direccion?: string;
    email?: string;
    telefono?: string;
  };
  numero?: string;
  ambiente?: string;
  fecha_emision: Date;
  clave_acceso: string;
  secuencial: string;
  estado: string;
  total_sin_impuestos: number;
  total_iva: number;
  total_con_impuestos: number;
  xml: string;
  xml_firmado: string;
  xml_autorizado?: string;
  ride_pdf: Buffer;
  autorizacion_numero: string;
  fecha_autorizacion: Date;
  sri_estado?: string;
  sri_mensajes?: any;
  sri_fecha_envio?: Date;
  sri_fecha_respuesta?: Date;
  datos_originales?: string;
  pagos?: Array<{ forma_pago: string; total: number; plazo?: number; unidad_tiempo?: string }>;
  info_adicional?: Record<string, string>;
}

const schema = new Schema<IInvoice>(
  {
    empresa_emisora_id: { type: Schema.Types.ObjectId, ref: 'IssuingCompany', required: true },
    cliente_id: { type: Schema.Types.ObjectId, ref: 'Client' },
    comprador: { type: Schema.Types.Mixed },
    numero: { type: String },
    ambiente: { type: String },
    fecha_emision: { type: Date, required: true },
    clave_acceso: { type: String, required: true, unique: true },
    secuencial: { type: String, required: true },
    estado: { type: String, required: true },
    total_sin_impuestos: { type: Number, required: true },
    total_iva: { type: Number, required: true },
    total_con_impuestos: { type: Number, required: true },
    xml: { type: String },
    xml_firmado: { type: String },
    xml_autorizado: { type: String },
    ride_pdf: { type: Buffer },
    autorizacion_numero: { type: String },
    fecha_autorizacion: { type: Date },
    sri_estado: { type: String },
    sri_mensajes: { type: Schema.Types.Mixed },
    sri_fecha_envio: { type: Date },
    sri_fecha_respuesta: { type: Date },
    datos_originales: { type: String },
    pagos: {
      type: [{ _id: false, forma_pago: String, total: Number, plazo: Number, unidad_tiempo: String }],
      default: undefined,
    },
    info_adicional: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

schema.index({ empresa_emisora_id: 1, secuencial: -1 });

export default model<IInvoice>('Invoice', schema);
