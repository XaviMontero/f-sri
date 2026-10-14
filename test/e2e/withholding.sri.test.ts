import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { startMongo, stopMongo } from '../helpers/mongo';
import { authFor, moduleApp } from '../helpers/moduleApp';
import { silentLogger } from '../../src/application/ports/runtime';
import { EmissionDate } from '../../src/domain/invoice/EmissionDate';
import { MongoCertificateStore } from '../../src/infrastructure/certificates/MongoCertificateStore';
import { MongoBuyerRepository } from '../../src/infrastructure/persistence/MongoBuyerRepository';
import { MongoIssuerRepository } from '../../src/infrastructure/persistence/MongoIssuerRepository';
import { MongoProductRepository } from '../../src/infrastructure/persistence/MongoProductRepository';
import { MongoSequenceGenerator } from '../../src/infrastructure/persistence/MongoSequenceGenerator';
import { FirmaEcXadesSigner } from '../../src/infrastructure/signing/FirmaEcXadesSigner';
import { DEFAULT_SRI_ENDPOINTS, SriSoapGateway } from '../../src/infrastructure/sri/SriSoapGateway';
import { createWithholdingModule } from '../../src/modules/withholding';
import IssuingCompany from '../../src/models/IssuingCompany';
import { encrypt } from '../../src/utils/encryption.utils';

/**
 * E2E contra el SRI de PRUEBAS (celcer) con firma real. Opt-in:
 *
 *   SRI_E2E_P12=/ruta/firma.p12 SRI_E2E_PASSWORD=... npx vitest run test/e2e/withholding.sri.test.ts
 *
 * Usa la serie 001-014 (reservada para retenciones de prueba). La base es efímera, así que el
 * secuencial vuelve a empezar: ante el error 45 (secuencial registrado) se declara el número como
 * `ultimos_secuenciales['07']` y se reintenta. SRI_E2E_ULTIMO_SECUENCIAL_07 acelera el arranque.
 */
const P12 = process.env.SRI_E2E_P12;
const PASSWORD = process.env.SRI_E2E_PASSWORD ?? '';
const RUC = '0106079783001';

describe.skipIf(!P12)('E2E SRI pruebas: comprobante de retención 07', () => {
  let companyId: string;

  beforeAll(async () => {
    await startMongo();
    const company = await IssuingCompany.create({
      ruc: RUC,
      razon_social: 'MONTERO CAMPOVERDE OSCAR XAVIER',
      nombre_comercial: 'MONTERO CAMPOVERDE OSCAR XAVIER',
      direccion: 'CUENCA',
      codigo_establecimiento: '001',
      punto_emision: '014',
      tipo_ambiente: 1,
      tipo_emision: 1,
      obligado_contabilidad: false,
      certificate: readFileSync(P12!).toString('base64'),
      certificate_password: encrypt(PASSWORD),
      ultimos_secuenciales: { '07': Number(process.env.SRI_E2E_ULTIMO_SECUENCIAL_07 ?? 0) },
      user_id: new Types.ObjectId(),
    });
    companyId = String(company._id);
  });
  afterAll(stopMongo);

  it('emite, firma y obtiene AUTORIZADO del SRI', async () => {
    const module = createWithholdingModule({
      issuers: new MongoIssuerRepository(),
      buyers: new MongoBuyerRepository(),
      products: new MongoProductRepository(),
      sequences: new MongoSequenceGenerator(),
      certificates: new MongoCertificateStore(),
      signer: new FirmaEcXadesSigner(),
      sri: new SriSoapGateway({ endpoints: DEFAULT_SRI_ENDPOINTS, timeoutMs: 60000 }),
      logger: silentLogger,
      submitOptions: { authorizationAttempts: 10, authorizationDelayMs: 3000 },
      ride: null,
    });
    const today = EmissionDate.todayInEcuador();
    const period = `${String(today.month).padStart(2, '0')}/${today.year}`;

    const app = moduleApp(module);
    const payload = {
      retencion: {
        infoTributaria: { ruc: RUC },
        infoCompRetencion: {
          fechaEmision: today.toSriFormat(),
          tipoIdentificacionSujetoRetenido: '05',
          parteRel: 'NO',
          razonSocialSujetoRetenido: 'MONTERO CAMPOVERDE OSCAR XAVIER',
          identificacionSujetoRetenido: '0106079783',
          periodoFiscal: period,
        },
        docsSustento: [
          {
            docSustento: {
              codSustento: '01',
              codDocSustento: '01',
              numDocSustento: '001009000000001',
              fechaEmisionDocSustento: '13/10/2026',
              numAutDocSustento: '1310202601010607978300110010090000000019093224818',
              pagoLocExt: '01',
              totalSinImpuestos: '10.00',
              importeTotal: '11.50',
              impuestosDocSustento: [
                {
                  impuestoDocSustento: {
                    codImpuestoDocSustento: '2',
                    codigoPorcentaje: '4',
                    baseImponible: '10.00',
                    tarifa: '15',
                    valorImpuesto: '1.50',
                  },
                },
              ],
              retenciones: [
                {
                  retencion: {
                    codigo: '1',
                    codigoRetencion: '303',
                    baseImponible: '10.00',
                    porcentajeRetener: '10',
                    valorRetenido: '1.00',
                  },
                },
              ],
              pagos: [{ pago: { formaPago: '01', total: '11.50' } }],
            },
          },
        ],
      },
    };

    let res = await request(app)
      .post('/api/v1/withholding/complete?esperar=true')
      .set(authFor(companyId))
      .send(payload);
    for (let attempt = 0; attempt < 25 && sequentialAlreadyUsed(res.body.data); attempt++) {
      await IssuingCompany.updateOne(
        { _id: companyId },
        { $set: { 'ultimos_secuenciales.07': Number(res.body.data.secuencial) } },
      );
      res = await request(app).post('/api/v1/withholding/complete?esperar=true').set(authFor(companyId)).send(payload);
    }

    console.log('SRI retención 07:', JSON.stringify(res.body.data, null, 2));
    expect(res.status).toBe(201);
    expect(res.body.data.estado, JSON.stringify(res.body.data.mensajes)).toBe('AUTORIZADO');
    expect(res.body.data.clave_acceso).toHaveLength(49);
  }, 180000);
});

function sequentialAlreadyUsed(data: { estado?: string; mensajes?: Array<{ identifier: string }> } | undefined) {
  return data?.estado === 'DEVUELTA' && Boolean(data.mensajes?.some((m) => m.identifier === '45'));
}
