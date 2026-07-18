import mongoose, { Schema, Document } from 'mongoose';

/**
 * PDF (RIDE) de una nota de crédito.
 * Igual que InvoicePDF, no almacena el buffer: solo la URL pública del proveedor.
 */
export interface ICreditNotePDF extends Document {
  nota_credito_id: string;
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

const CreditNotePDFSchema: Schema = new Schema({
  nota_credito_id: { type: String, required: true, ref: 'CreditNote' },
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

CreditNotePDFSchema.index({ nota_credito_id: 1 });
CreditNotePDFSchema.index({ pdf_public_id: 1 });

export default mongoose.model<ICreditNotePDF>('CreditNotePDF', CreditNotePDFSchema);
