import Product, { IProduct } from '../../models/Product';
import { ProductRecord, ProductRepository } from '../../application/ports/repositories';

export class MongoProductRepository implements ProductRepository {
  async findByCodes(codes: string[]): Promise<Map<string, ProductRecord>> {
    const products = await Product.find({ codigo: { $in: [...new Set(codes)] } }).lean<IProduct[]>();
    return new Map(
      products.map((p) => [
        p.codigo,
        {
          id: String(p._id),
          code: p.codigo,
          description: p.descripcion,
          unitPrice: p.precio_unitario,
          chargesIva: p.tiene_iva,
          additionalDescription: p.descripcion_adicional,
        },
      ]),
    );
  }
}
