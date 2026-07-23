import mongoose, { Schema, Document } from 'mongoose';

/**
 * PDF (RIDE) de un comprobante de retención.
 * Igual que InvoicePDF, no almacena el buffer: solo la URL pública del proveedor.
 */
export interface IWithholdingPDF extends Document {
  retencion_id: string;
  claveAcceso: string;

  pdf_url: string;
  pdf_public_id: string;
  pdf_provider: string;

  fecha_generacion: Date;
  estado: 'GENERADO' | 'ERROR';
  tamano_archivo: number;
  numero_autorizacion: string;
  fecha_autorizacion: Date;
}

const WithholdingPDFSchema: Schema = new Schema({
  retencion_id: { type: String, required: true, ref: 'Withholding' },
  claveAcceso: { type: String, required: true, unique: true },

  pdf_url: { type: String },
  pdf_public_id: { type: String },
  pdf_provider: { type: String, default: 'local' },

  fecha_generacion: { type: Date, default: Date.now },
  estado: { type: String, enum: ['GENERADO', 'ERROR'], default: 'GENERADO' },
  tamano_archivo: { type: Number, required: true, default: 0 },
  numero_autorizacion: { type: String, required: true },
  fecha_autorizacion: { type: Date, required: true },
});

WithholdingPDFSchema.index({ retencion_id: 1 });
WithholdingPDFSchema.index({ pdf_public_id: 1 });

export default mongoose.model<IWithholdingPDF>('WithholdingPDF', WithholdingPDFSchema);
