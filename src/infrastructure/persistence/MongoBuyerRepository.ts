import Client, { IClient } from '../../models/Client';
import { BuyerRepository } from '../../application/ports/repositories';
import { Buyer } from '../../domain/invoice/Invoice';

export class MongoBuyerRepository implements BuyerRepository {
  async findByIdentification(identification: string): Promise<(Buyer & { id: string; recordId: string }) | null> {
    const client = await Client.findOne({ identificacion: identification }).lean<IClient>();
    if (!client) return null;
    return {
      recordId: String(client._id),
      idType: '',
      id: client.identificacion,
      name: client.razon_social,
      address: client.direccion || undefined,
      email: client.email || undefined,
      phone: client.telefono || undefined,
    };
  }
}
