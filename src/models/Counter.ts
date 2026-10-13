import { Schema, model } from 'mongoose';

/** Contador atómico de secuenciales: `_id` = ruc-estab-ptoEmi-codDoc. */
export interface ICounter {
  _id: string;
  seq: number;
}

const schema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

export default model<ICounter>('Counter', schema);
