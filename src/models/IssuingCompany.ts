import { Schema, model, Document, Types } from 'mongoose';

export interface IIssuingCompany extends Document {
  ruc: string;
  razon_social: string;
  nombre_comercial: string;
  direccion?: string;
  direccion_matriz?: string;
  direccion_establecimiento?: string;
  telefono?: string;
  email?: string;
  codigo_establecimiento: string;
  punto_emision: string;
  tipo_ambiente: number;
  tipo_emision: number;
  obligado_contabilidad?: boolean;
  contribuyente_especial?: string;
  email_notificacion?: string;
  certificate?: string;
  /** Último secuencial ya emitido para estab/ptoEmi antes de usar f-sri (los siguientes parten de aquí). */
  ultimo_secuencial?: number;
  /** Último secuencial ya emitido por codDoc ('04', '05', '06', '07'…); para '01' prima sobre `ultimo_secuencial`. */
  ultimos_secuenciales?: Record<string, number>;
  certificate_password?: string;
  user_id: Types.ObjectId; // Reference to User
}

const schema = new Schema<IIssuingCompany>(
  {
    ruc: { type: String, required: true, unique: true },
    razon_social: { type: String, required: true },
    nombre_comercial: { type: String, required: true },
    direccion: { type: String },
    direccion_matriz: { type: String },
    direccion_establecimiento: { type: String },
    telefono: { type: String },
    email: { type: String },
    codigo_establecimiento: { type: String, required: true, default: '001' },
    punto_emision: { type: String, required: true, default: '001' },
    tipo_ambiente: { type: Number, required: true, default: 1 }, // 1 = Pruebas, 2 = Producción
    tipo_emision: { type: Number, required: true, default: 1 }, // 1 = Normal
    obligado_contabilidad: { type: Boolean, default: false },
    contribuyente_especial: { type: String },
    email_notificacion: { type: String },
    certificate: { type: String },
    ultimo_secuencial: { type: Number, min: 0, max: 999999999 },
    ultimos_secuenciales: { type: Map, of: Number },
    certificate_password: { type: String },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true, // Add createdAt and updatedAt
    toJSON: {
      // El certificado y su clave nunca salen por la API.
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.tiene_certificado = Boolean(ret.certificate);
        delete ret.certificate;
        delete ret.certificate_password;
        return ret;
      },
    },
  },
);

// Index for better performance
// El índice de ruc ya se crea automáticamente con unique: true
schema.index({ user_id: 1 });

export default model<IIssuingCompany>('IssuingCompany', schema);
