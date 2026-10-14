import Counter from '../../models/Counter';
import Invoice from '../../models/Invoice';
import IssuingCompany from '../../models/IssuingCompany';
import { SequenceGenerator } from '../../application/ports/repositories';

/**
 * Secuenciales atómicos con `$inc` sobre un contador por serie. La primera vez se
 * inicializa con el mayor secuencial ya emitido, para no repetir números de la versión anterior.
 */
export class MongoSequenceGenerator implements SequenceGenerator {
  async next(key: {
    ruc: string;
    establishment: string;
    emissionPoint: string;
    documentType: string;
  }): Promise<string> {
    const id = `${key.ruc}-${key.establishment}-${key.emissionPoint}-${key.documentType}`;
    if (!(await Counter.exists({ _id: id }))) {
      // Facturas emitidas antes de existir el contador (solo aplica a codDoc 01).
      const seed = key.documentType === '01' ? await this.lastIssued(key.ruc) : 0;
      try {
        await Counter.updateOne({ _id: id }, { $setOnInsert: { seq: seed } }, { upsert: true });
      } catch (error) {
        // Dos inicializaciones concurrentes: la otra ganó el upsert, seguimos con $inc.
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }
    // seq = max(seq, último secuencial declarado por la empresa) + 1, en una sola operación atómica.
    const floor = await this.declaredLastSequential(key.ruc, key.documentType);
    const counter = await Counter.findOneAndUpdate(
      { _id: id },
      [{ $set: { seq: { $add: [{ $max: [{ $ifNull: ['$seq', 0] }, floor] }, 1] } } }],
      { new: true },
    );
    return String(counter!.seq).padStart(9, '0');
  }

  /**
   * Último número ya emitido fuera de f-sri (otro sistema, otra instalación): evita el error 45
   * "SECUENCIAL REGISTRADO". `ultimos_secuenciales` va por codDoc; `ultimo_secuencial` es el de facturas.
   */
  private async declaredLastSequential(ruc: string, documentType: string): Promise<number> {
    const company = await IssuingCompany.findOne({ ruc }).select('ultimo_secuencial ultimos_secuenciales').lean();
    const byType = company?.ultimos_secuenciales?.[documentType];
    const declared = byType ?? (documentType === '01' ? company?.ultimo_secuencial : undefined);
    return Number(declared) || 0;
  }

  private async lastIssued(ruc: string): Promise<number> {
    const company = await IssuingCompany.findOne({ ruc }).select('_id').lean();
    if (!company) return 0;
    const last = await Invoice.findOne({ empresa_emisora_id: company._id })
      .sort({ secuencial: -1 })
      .select('secuencial')
      .lean();
    return last ? Number(last.secuencial) || 0 : 0;
  }
}
