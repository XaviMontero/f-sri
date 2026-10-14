import { Types } from 'mongoose';
import { SriDocumentUpdate } from '../../../application/ports/repositories';
import { NotFoundError } from '../../../domain/shared/errors';
import {
  sriDocumentInsert,
  sriDocumentSet,
  toSriDocumentRecord,
} from '../../../infrastructure/persistence/sriDocumentMongo';
import { CreditNoteRecord, CreditNoteRepository, NewCreditNoteRecord } from '../application/IssueCreditNote';
import { DOCUMENT_TYPE_CREDIT_NOTE } from '../domain/CreditNote';
import { CreditNoteDoc, CreditNoteModel } from './CreditNoteModel';

/** Persistencia de notas de crédito (detalles e impuestos embebidos, nombres en español). */
export class MongoCreditNoteRepository implements CreditNoteRepository {
  async create(record: NewCreditNoteRecord): Promise<CreditNoteRecord> {
    const doc = await CreditNoteModel.create({
      ...sriDocumentInsert(record, record.request),
      tipo_documento: DOCUMENT_TYPE_CREDIT_NOTE,
      cliente_id: record.buyerRecordId,
      comprador: {
        tipo_identificacion: record.buyer.idType,
        identificacion: record.buyer.id,
        razon_social: record.buyer.name,
        direccion: record.buyer.address,
        email: record.buyer.email,
        telefono: record.buyer.phone,
      },
      cod_doc_modificado: record.modifiedDocument.type,
      num_doc_modificado: record.modifiedDocument.number,
      fecha_emision_doc_sustento: record.modifiedDocument.emissionDate,
      motivo: record.reason,
      total_sin_impuestos: record.subtotal,
      total_iva: record.totalTax,
      valor_modificacion: record.total,
      impuestos: record.taxes.map((t) => ({
        codigo: t.taxCode,
        codigo_porcentaje: t.ivaCode,
        tarifa: t.rate,
        base_imponible: t.base,
        valor: t.value,
      })),
      detalles: record.lines.map((l) => ({
        producto_id: l.productId,
        codigo_interno: l.code,
        codigo_adicional: l.auxiliaryCode,
        descripcion: l.description,
        cantidad: l.quantity,
        precio_unitario: l.unitPrice,
        descuento: l.discount,
        precio_total_sin_impuesto: l.subtotal,
        codigo_porcentaje_iva: l.ivaCode,
        tarifa_iva: l.ivaRate,
        valor_iva: l.taxValue,
      })),
      info_adicional: record.additionalInfo,
    });
    return toCreditNoteRecord(doc.toObject() as CreditNoteDoc);
  }

  async findById(id: string): Promise<CreditNoteRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await CreditNoteModel.findById(id).lean<CreditNoteDoc>();
    return doc ? toCreditNoteRecord(doc) : null;
  }

  async update(id: string, changes: SriDocumentUpdate): Promise<CreditNoteRecord> {
    const doc = await CreditNoteModel.findByIdAndUpdate(
      id,
      { $set: sriDocumentSet(changes) },
      { new: true },
    ).lean<CreditNoteDoc>();
    if (!doc) throw new NotFoundError('Nota de crédito no encontrada');
    return toCreditNoteRecord(doc);
  }
}

export function toCreditNoteRecord(doc: CreditNoteDoc): CreditNoteRecord {
  const buyer = doc.comprador;
  return {
    ...toSriDocumentRecord(doc, DOCUMENT_TYPE_CREDIT_NOTE),
    buyerRecordId: doc.cliente_id ? String(doc.cliente_id) : undefined,
    buyer: {
      idType: buyer?.tipo_identificacion ?? '',
      id: buyer?.identificacion ?? '',
      name: buyer?.razon_social ?? '',
      address: buyer?.direccion,
      email: buyer?.email,
      phone: buyer?.telefono,
    },
    modifiedDocument: {
      type: doc.cod_doc_modificado,
      number: doc.num_doc_modificado,
      emissionDate: doc.fecha_emision_doc_sustento,
    },
    reason: doc.motivo,
    subtotal: doc.total_sin_impuestos,
    totalTax: doc.total_iva,
    total: doc.valor_modificacion,
    taxes: (doc.impuestos ?? []).map((t) => ({
      taxCode: t.codigo,
      ivaCode: t.codigo_porcentaje,
      rate: t.tarifa,
      base: t.base_imponible,
      value: t.valor,
    })),
    lines: (doc.detalles ?? []).map((d) => ({
      productId: d.producto_id ? String(d.producto_id) : undefined,
      code: d.codigo_interno,
      auxiliaryCode: d.codigo_adicional || undefined,
      description: d.descripcion,
      quantity: d.cantidad,
      unitPrice: d.precio_unitario,
      discount: d.descuento ?? 0,
      subtotal: d.precio_total_sin_impuesto,
      ivaCode: d.codigo_porcentaje_iva,
      ivaRate: d.tarifa_iva,
      taxValue: d.valor_iva,
    })),
    additionalInfo: doc.info_adicional,
  };
}
