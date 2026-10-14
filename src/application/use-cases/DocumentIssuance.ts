import { AccessKey } from '../../domain/invoice/AccessKey';
import { EmissionDate } from '../../domain/invoice/EmissionDate';
import { ForbiddenError, NotFoundError } from '../../domain/shared/errors';
import { IssuerRecord, IssuerRepository, SequenceGenerator } from '../ports/repositories';
import { Clock, systemClock } from '../ports/runtime';
import { Actor } from './IssueInvoice';

export interface DocumentIssuanceDeps {
  issuers: IssuerRepository;
  sequences: SequenceGenerator;
  clock?: Clock;
  random?: () => number;
}

/**
 * Pasos comunes a la emisión de cualquier comprobante: resolver el emisor (acotado a la
 * empresa del usuario), fecha de emisión, y reservar secuencial + clave de acceso.
 * Cada caso de uso valida su agregado ANTES de llamar a {@link allocate} para no dejar huecos.
 */
export class DocumentIssuance {
  constructor(private readonly deps: DocumentIssuanceDeps) {}

  async issuer(ruc: string, actor: Actor = {}): Promise<IssuerRecord> {
    const record = await this.deps.issuers.findByRuc(ruc);
    if (!record) throw new NotFoundError('Empresa emisora no encontrada', 400);
    if (actor.companyId && actor.companyId !== record.id) {
      throw new ForbiddenError('No puede emitir comprobantes a nombre de otra empresa');
    }
    return record;
  }

  /** dd/mm/aaaa recibido o, por defecto, hoy en Ecuador. */
  emissionDate(input?: string): EmissionDate {
    return input ? EmissionDate.parse(input) : EmissionDate.todayInEcuador((this.deps.clock ?? systemClock).now());
  }

  async allocate(
    issuer: IssuerRecord,
    documentType: string,
    emissionDate: EmissionDate,
  ): Promise<{ sequential: string; accessKey: AccessKey; number: string }> {
    const { ruc, establishment, emissionPoint, environment, emissionType } = issuer.issuer;
    const sequential = await this.deps.sequences.next({ ruc, establishment, emissionPoint, documentType });
    const accessKey = AccessKey.generate({
      emissionDate,
      documentType,
      ruc,
      environment,
      series: `${establishment}${emissionPoint}`,
      sequential,
      numericCode: AccessKey.randomNumericCode(this.deps.random),
      emissionType,
    });
    return { sequential, accessKey, number: `${establishment}-${emissionPoint}-${sequential}` };
  }
}
