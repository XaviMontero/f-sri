import { Schema, model, Document, Types } from 'mongoose';

export interface ICreditNoteDetail extends Document {
  nota_credito_id: Types.ObjectId;
  producto_id: Types.ObjectId;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  valor_iva: number;
}

const schema = new Schema<ICreditNoteDetail>({
  nota_credito_id: { type: Schema.Types.ObjectId, ref: 'CreditNote', required: true },
  producto_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  cantidad: { type: Number, required: true },
  precio_unitario: { type: Number, required: true },
  subtotal: { type: Number, required: true },
  valor_iva: { type: Number, required: true },
});

export default model<ICreditNoteDetail>('CreditNoteDetail', schema);
