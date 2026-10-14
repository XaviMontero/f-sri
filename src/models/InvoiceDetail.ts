import { Schema, model, Document, Types } from 'mongoose';

export interface IInvoiceDetail extends Document {
  factura_id: Types.ObjectId;
  producto_id?: Types.ObjectId;
  codigo?: string;
  descripcion?: string;
  descuento?: number;
  codigo_porcentaje_iva?: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  valor_iva: number;
}

const schema = new Schema<IInvoiceDetail>({
  factura_id: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
  producto_id: { type: Schema.Types.ObjectId, ref: 'Product' },
  codigo: { type: String },
  descripcion: { type: String },
  descuento: { type: Number, default: 0 },
  codigo_porcentaje_iva: { type: String },
  cantidad: { type: Number, required: true },
  precio_unitario: { type: Number, required: true },
  subtotal: { type: Number, required: true },
  valor_iva: { type: Number, required: true },
});

export default model<IInvoiceDetail>('InvoiceDetail', schema);
