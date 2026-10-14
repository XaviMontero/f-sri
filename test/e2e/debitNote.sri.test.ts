import { readFileSync } from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { startMongo, stopMongo } from '../helpers/mongo';
import { authFor, moduleApp } from '../helpers/moduleApp';
import { consoleLogger } from '../../src/application/ports/runtime';
import { EmissionDate } from '../../src/domain/invoice/EmissionDate';
import { MongoCertificateStore } from '../../src/infrastructure/certificates/MongoCertificateStore';
import { MongoBuyerRepository } from '../../src/infrastructure/persistence/MongoBuyerRepository';
import { MongoIssuerRepository } from '../../src/infrastructure/persistence/MongoIssuerRepository';
import { MongoProductRepository } from '../../src/infrastructure/persistence/MongoProductRepository';
import { MongoSequenceGenerator } from '../../src/infrastructure/persistence/MongoSequenceGenerator';
import { FirmaEcXadesSigner } from '../../src/infrastructure/signing/FirmaEcXadesSigner';
import { DEFAULT_SRI_ENDPOINTS, SriSoapGateway } from '../../src/infrastructure/sri/SriSoapGateway';
import IssuingCompany from '../../src/models/IssuingCompany';
import { createDebitNoteModule } from '../../src/modules/debitNote';
import { encrypt } from '../../src/utils/encryption.utils';

/**
 * E2E contra el ambiente de PRUEBAS real del SRI (opt-in):
 *
 *   SRI_E2E_P12=/ruta/al/certificado.p12 SRI_E2E_PASSWORD=*** \
 *     npx vitest run test/e2e/debitNote.sri.test.ts
 *
 * Emite una nota de débito (serie 001-012) que modifica la factura 001-009-000000001 del
 * 13/10/2026, ya AUTORIZADA en pruebas. Si el SRI responde error 45 (secuencial registrado),
 * declare el último emitido con SRI_E2E_LAST_SEQUENTIAL_05=n.
 */
const P12 = process.env.SRI_E2E_P12;

function lastSequential(): Record<string, number> | undefined {
  const raw = process.env.SRI_E2E_LAST_SEQUENTIAL_05;
  const declared = Number(raw);
  return raw !== undefined && Number.isInteger(declared) && declared >= 0 ? { '05': declared } : undefined;
}

describe.skipIf(!P12)('E2E SRI pruebas: nota de débito (codDoc 05)', () => {
  let companyId: string;

  beforeAll(async () => {
    await startMongo();
    const company = await IssuingCompany.create({
      ruc: '0106079783001',
      razon_social: 'MONTERO CAMPOVERDE OSCAR XAVIER',
      nombre_comercial: 'MONTERO CAMPOVERDE OSCAR XAVIER',
      direccion: 'CUENCA',
      direccion_matriz: 'CUENCA',
      direccion_establecimiento: 'CUENCA',
      codigo_establecimiento: '001',
      punto_emision: '012',
      tipo_ambiente: 1,
      tipo_emision: 1,
      obligado_contabilidad: false,
      certificate: readFileSync(P12!).toString('base64'),
      certificate_password: encrypt(process.env.SRI_E2E_PASSWORD ?? ''),
      ultimos_secuenciales: lastSequential(),
      user_id: new Types.ObjectId(),
    });
    companyId = String(company._id);
  });
  afterAll(stopMongo);

  it('el SRI AUTORIZA la nota de débito', { timeout: 120000 }, async () => {
    const app = moduleApp(
      createDebitNoteModule({
        issuers: new MongoIssuerRepository(),
        buyers: new MongoBuyerRepository(),
        products: new MongoProductRepository(),
        sequences: new MongoSequenceGenerator(),
        certificates: new MongoCertificateStore(),
        signer: new FirmaEcXadesSigner(),
        sri: new SriSoapGateway({ endpoints: DEFAULT_SRI_ENDPOINTS, timeoutMs: 60000 }),
        logger: consoleLogger,
        submitOptions: { authorizationAttempts: 10, authorizationDelayMs: 3000 },
        ride: null,
      }),
    );

    const res = await request(app)
      .post('/api/v1/debit-note/complete?esperar=true')
      .set(authFor(companyId))
      .send({
        nota_debito: {
          infoTributaria: { ruc: '0106079783001', claveAcceso: '', secuencial: '' },
          infoNotaDebito: {
            fechaEmision: EmissionDate.todayInEcuador().toSriFormat(),
            tipoIdentificacionComprador: '05',
            identificacionComprador: '0106079783',
            razonSocialComprador: 'MONTERO CAMPOVERDE OSCAR XAVIER',
            codDocModificado: '01',
            numDocModificado: '001-009-000000001',
            fechaEmisionDocSustento: '13/10/2026',
            totalSinImpuestos: '2.00',
            impuestos: [
              { impuesto: { codigo: '2', codigoPorcentaje: '4', tarifa: '15', baseImponible: '2.00', valor: '0.30' } },
            ],
            valorTotal: '2.30',
            pagos: [{ pago: { formaPago: '01', total: '2.30', plazo: '0', unidadTiempo: 'dias' } }],
          },
          motivos: [{ motivo: { razon: 'Interés por mora', valor: '2.00' } }],
          infoAdicional: { Email: 'xavier.montero@example.com' },
        },
      });

    console.log('Respuesta SRI (nota de débito):', JSON.stringify(res.body.data, null, 2));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.estado, JSON.stringify(res.body.data.mensajes)).toBe('AUTORIZADO');
    expect(res.body.data.clave_acceso).toMatch(/^\d{49}$/);
    expect(res.body.data.numero).toMatch(/^001-012-\d{9}$/);
  });
});
