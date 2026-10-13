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
    const counter = await Counter.findOneAndUpdate({ _id: id }, { $inc: { seq: 1 } }, { new: true });
    return String(counter!.seq).padStart(9, '0');
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
