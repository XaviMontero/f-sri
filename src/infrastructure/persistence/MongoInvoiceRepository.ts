import { Types } from 'mongoose';
import Invoice, { IInvoice } from '../../models/Invoice';
import InvoiceDetail from '../../models/InvoiceDetail';
import {
  InvoiceRecord,
  InvoiceRepository,
  InvoiceUpdate,
  NewInvoiceRecord,
} from '../../application/ports/repositories';
import { NotFoundError } from '../../domain/shared/errors';
import { ivaRate } from '../../domain/invoice/catalogs';

/** Mapea el agregado persistido al esquema Mongo existente (nombres de campo en español). */
export class MongoInvoiceRepository implements InvoiceRepository {
  async create(record: NewInvoiceRecord): Promise<InvoiceRecord> {
    const doc = await Invoice.create({
      empresa_emisora_id: record.issuerId,
      cliente_id: record.buyerRecordId,
      comprador: {
        tipo_identificacion: record.buyer.idType,
        identificacion: record.buyer.id,
        razon_social: record.buyer.name,
        direccion: record.buyer.address,
        email: record.buyer.email,
        telefono: record.buyer.phone,
      },
      numero: record.number,
      ambiente: record.environment,
      fecha_emision: record.emissionDate,
      clave_acceso: record.accessKey,
      secuencial: record.sequential,
      estado: record.status,
      sri_estado: record.status,
      total_sin_impuestos: record.subtotal,
      total_iva: record.totalTax,
      total_con_impuestos: record.total,
      xml: record.xml,
      pagos: record.payments?.map((p) => ({
        forma_pago: p.method,
        total: p.amount,
        plazo: p.term,
        unidad_tiempo: p.timeUnit,
      })),
      info_adicional: record.additionalInfo,
      datos_originales: record.request === undefined ? undefined : JSON.stringify(record.request),
    });
    await InvoiceDetail.insertMany(
      record.lines.map((l) => ({
        factura_id: doc._id,
        producto_id: l.productId,
        codigo: l.code,
        descripcion: l.description,
        cantidad: l.quantity,
        precio_unitario: l.unitPrice,
        descuento: l.discount,
        subtotal: l.subtotal,
        codigo_porcentaje_iva: l.ivaCode,
        valor_iva: l.taxValue,
      })),
    );
    return this.toRecord(doc.toObject() as IInvoice);
  }

  async findById(id: string): Promise<InvoiceRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await Invoice.findById(id).lean<IInvoice>();
    return doc ? this.toRecord(doc) : null;
  }

  async update(id: string, changes: InvoiceUpdate): Promise<InvoiceRecord> {
    const set: Record<string, unknown> = {};
    if (changes.status !== undefined) {
      set.estado = changes.status;
      set.sri_estado = changes.status;
    }
    if (changes.signedXml !== undefined) set.xml_firmado = changes.signedXml;
    if (changes.authorizedXml !== undefined) set.xml_autorizado = changes.authorizedXml;
    if (changes.authorizationNumber !== undefined) set.autorizacion_numero = changes.authorizationNumber;
    if (changes.authorizationDate !== undefined) set.fecha_autorizacion = changes.authorizationDate;
    if (changes.sentAt !== undefined) set.sri_fecha_envio = changes.sentAt;
    if (changes.respondedAt !== undefined) set.sri_fecha_respuesta = changes.respondedAt;
    if (changes.messages !== undefined) set.sri_mensajes = changes.messages;

    const doc = await Invoice.findByIdAndUpdate(id, { $set: set }, { new: true }).lean<IInvoice>();
    if (!doc) throw new NotFoundError('Factura no encontrada');
    return this.toRecord(doc);
  }

  private async toRecord(doc: IInvoice): Promise<InvoiceRecord> {
    const details = await InvoiceDetail.find({ factura_id: doc._id }).lean();
    const buyer = doc.comprador;
    return {
      id: String(doc._id),
      issuerId: String(doc.empresa_emisora_id),
      buyerRecordId: doc.cliente_id ? String(doc.cliente_id) : undefined,
      buyer: {
        idType: buyer?.tipo_identificacion ?? '',
        id: buyer?.identificacion ?? '',
        name: buyer?.razon_social ?? '',
        address: buyer?.direccion,
        email: buyer?.email,
        phone: buyer?.telefono,
      },
      accessKey: doc.clave_acceso,
      sequential: doc.secuencial,
      number: doc.numero ?? doc.secuencial,
      environment: doc.ambiente === '2' ? '2' : '1',
      emissionDate: doc.fecha_emision,
      subtotal: doc.total_sin_impuestos,
      totalTax: doc.total_iva,
      total: doc.total_con_impuestos,
      status: doc.sri_estado ?? doc.estado,
      xml: doc.xml,
      signedXml: doc.xml_firmado || undefined,
      authorizedXml: doc.xml_autorizado || undefined,
      authorizationNumber: doc.autorizacion_numero || undefined,
      authorizationDate: doc.fecha_autorizacion || undefined,
      sentAt: doc.sri_fecha_envio,
      respondedAt: doc.sri_fecha_respuesta,
      messages: Array.isArray(doc.sri_mensajes) ? doc.sri_mensajes : undefined,
      payments: doc.pagos?.map((p) => ({
        method: p.forma_pago,
        amount: p.total,
        term: p.plazo,
        timeUnit: p.unidad_tiempo,
      })),
      additionalInfo: doc.info_adicional,
      lines: details.map((d) => ({
        productId: d.producto_id ? String(d.producto_id) : undefined,
        code: d.codigo ?? '',
        description: d.descripcion ?? '',
        quantity: d.cantidad,
        unitPrice: d.precio_unitario,
        discount: d.descuento ?? 0,
        subtotal: d.subtotal,
        ivaCode: d.codigo_porcentaje_iva ?? '',
        ivaRate: safeRate(d.codigo_porcentaje_iva),
        taxValue: d.valor_iva,
      })),
    };
  }
}

function safeRate(code?: string): number {
  try {
    return code ? ivaRate(code).rate : 0;
  } catch {
    return 0;
  }
}
