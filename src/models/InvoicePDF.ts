import mongoose, { Schema, Document } from 'mongoose';

/**
 * Interfaz del modelo InvoicePDF
 *
 * IMPORTANTE: Este modelo ya NO almacena el pdf_buffer en la base de datos
 * para evitar problemas de tamaño. En su lugar, almacena:
 * - pdf_url: URL pública del PDF (en Cloudinary, local, etc.)
 * - pdf_public_id: ID único para gestionar el archivo
 * - pdf_provider: Proveedor utilizado (cloudinary, local, s3, etc.)
 */
export interface IInvoicePDF extends Document {
  factura_id: string;
  tipo_documento?: string;
  claveAcceso: string;

  // Información del almacenamiento (sin buffer)
  pdf_url: string; // URL pública del PDF
  pdf_public_id: string; // ID único en el proveedor (para eliminar/actualizar)
  pdf_provider: string; // Proveedor: cloudinary, local, s3, azure, etc.

  fecha_generacion: Date;
  estado: 'GENERADO' | 'ERROR';
  tamano_archivo: number;
  numero_autorizacion: string;
  fecha_autorizacion: Date;

  // Email sending fields
  email_estado: 'PENDIENTE' | 'ENVIADO' | 'ERROR' | 'NO_ENVIADO';
  email_destinatario?: string;
  email_fecha_envio?: Date;
  email_intentos: number;
  email_ultimo_error?: string;
  email_enviado_por?: string; // ID del usuario que envió
}

const InvoicePDFSchema: Schema = new Schema({
  /** Id del comprobante (factura u otro tipo; ver tipo_documento). */
  factura_id: { type: String, required: true, ref: 'Invoice' },
  /** codDoc del comprobante: 01 factura, 04 nota de crédito, 05 nota de débito, 06 guía, 07 retención. */
  tipo_documento: { type: String, default: '01' },
  claveAcceso: { type: String, required: true, unique: true },

  // Campos actualizados para el nuevo sistema de almacenamiento
  pdf_url: { type: String, required: true }, // URL pública del PDF
  pdf_public_id: { type: String, required: true }, // ID único en el proveedor
  pdf_provider: { type: String, required: true, default: 'local' }, // Proveedor de almacenamiento

  fecha_generacion: { type: Date, default: Date.now },
  estado: { type: String, enum: ['GENERADO', 'ERROR'], default: 'GENERADO' },
  tamano_archivo: { type: Number, required: true },
  numero_autorizacion: { type: String, required: true },
  fecha_autorizacion: { type: Date, required: true },

  // Email sending fields
  email_estado: {
    type: String,
    enum: ['PENDIENTE', 'ENVIADO', 'ERROR', 'NO_ENVIADO'],
    required: true,
    default: 'NO_ENVIADO',
  },
  email_destinatario: { type: String },
  email_fecha_envio: { type: Date },
  email_intentos: { type: Number, required: true, default: 0 },
  email_ultimo_error: { type: String },
  email_enviado_por: { type: String },
});

// Índice para búsquedas rápidas por factura
InvoicePDFSchema.index({ factura_id: 1 });
InvoicePDFSchema.index({ pdf_public_id: 1 });

export default mongoose.model<IInvoicePDF>('InvoicePDF', InvoicePDFSchema);
