import IssuingCompany, { IIssuingCompany } from '../../models/IssuingCompany';
import { IssuerRecord, IssuerRepository } from '../../application/ports/repositories';

export class MongoIssuerRepository implements IssuerRepository {
  async findByRuc(ruc: string): Promise<IssuerRecord | null> {
    const company = await IssuingCompany.findOne({ ruc }).lean<IIssuingCompany>();
    return company ? toIssuerRecord(company) : null;
  }
}

export function toIssuerRecord(company: IIssuingCompany): IssuerRecord {
  const address = company.direccion_matriz || company.direccion || '';
  return {
    id: String(company._id),
    userId: company.user_id ? String(company.user_id) : undefined,
    email: company.email,
    phone: company.telefono,
    issuer: {
      ruc: company.ruc,
      businessName: company.razon_social,
      tradeName: company.nombre_comercial,
      headOfficeAddress: address,
      establishmentAddress: company.direccion_establecimiento || company.direccion || undefined,
      establishment: company.codigo_establecimiento,
      emissionPoint: company.punto_emision,
      environment: String(company.tipo_ambiente) === '2' ? '2' : '1',
      emissionType: '1',
      keepsAccounting: Boolean(company.obligado_contabilidad),
      specialTaxpayer: company.contribuyente_especial || undefined,
    },
  };
}
