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
      const seed = await this.lastIssued(key.ruc);
      try {
        await Counter.updateOne({ _id: id }, { $setOnInsert: { seq: seed } }, { upsert: true });
      } catch (error) {
        // Dos inicializaciones concurrentes: la otra ganó el upsert, seguimos con $inc.
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }
    // seq = max(seq, último secuencial declarado por la empresa) + 1, en una sola operación atómica.
    const floor = await this.declaredLastSequential(key.ruc);
    const counter = await Counter.findOneAndUpdate(
      { _id: id },
      [{ $set: { seq: { $add: [{ $max: [{ $ifNull: ['$seq', 0] }, floor] }, 1] } } }],
      { new: true },
    );
    return String(counter!.seq).padStart(9, '0');
  }

  /**
   * `ultimo_secuencial` de la empresa: el último número ya emitido fuera de f-sri (otro sistema,
   * otra instalación). Evita el error 45 "SECUENCIAL REGISTRADO" del SRI.
   */
  private async declaredLastSequential(ruc: string): Promise<number> {
    const company = await IssuingCompany.findOne({ ruc }).select('ultimo_secuencial').lean();
    return Number(company?.ultimo_secuencial) || 0;
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
