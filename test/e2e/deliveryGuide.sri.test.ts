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
import { SriSoapGateway } from '../../src/infrastructure/sri/SriSoapGateway';
import IssuingCompany from '../../src/models/IssuingCompany';
import { createDeliveryGuideModule } from '../../src/modules/deliveryGuide';
import { encrypt } from '../../src/utils/encryption.utils';

/**
 * Guía de remisión contra el ambiente de PRUEBAS real del SRI (opt-in):
 *   SRI_E2E_P12=/ruta/al.p12 SRI_E2E_PASSWORD=... npx vitest run test/e2e/deliveryGuide.sri.test.ts
 * Serie reservada: 001-013. Si el SRI responde 45 (secuencial registrado), use
 * SRI_E2E_LAST_SEQUENTIAL=<último emitido> para continuar la numeración.
 */
const P12 = process.env.SRI_E2E_P12;
const PASSWORD = process.env.SRI_E2E_PASSWORD ?? '';

describe.skipIf(!P12)('E2E SRI pruebas — guía de remisión (codDoc 06)', () => {
  let companyId: string;
  let app: ReturnType<typeof moduleApp>;

  beforeAll(async () => {
    await startMongo();
    const lastSequential = Number(process.env.SRI_E2E_LAST_SEQUENTIAL) || 0;
    const company = await IssuingCompany.create({
      ruc: '0106079783001',
      razon_social: 'MONTERO CAMPOVERDE OSCAR XAVIER',
      nombre_comercial: 'MONTERO CAMPOVERDE OSCAR XAVIER',
      direccion: 'CUENCA',
      direccion_matriz: 'CUENCA',
      codigo_establecimiento: '001',
      punto_emision: '013',
      tipo_ambiente: 1,
      tipo_emision: 1,
      obligado_contabilidad: false,
      certificate: readFileSync(P12!).toString('base64'),
      certificate_password: encrypt(PASSWORD),
      ultimos_secuenciales: lastSequential ? { '06': lastSequential } : undefined,
      user_id: new Types.ObjectId(),
    });
    companyId = String(company._id);

    app = moduleApp(
      createDeliveryGuideModule({
        issuers: new MongoIssuerRepository(),
        buyers: new MongoBuyerRepository(),
        products: new MongoProductRepository(),
        sequences: new MongoSequenceGenerator(),
        certificates: new MongoCertificateStore(),
        signer: new FirmaEcXadesSigner(),
        sri: new SriSoapGateway(),
        logger: consoleLogger,
        submitOptions: { authorizationAttempts: 10, authorizationDelayMs: 3000 },
        ride: null,
      }),
    );
  });

  afterAll(stopMongo);

  it('el SRI AUTORIZA la guía de remisión', { timeout: 180_000 }, async () => {
    const today = EmissionDate.todayInEcuador().toSriFormat();
    const res = await request(app)
      .post('/api/v1/delivery-note/complete?esperar=true')
      .set(authFor(companyId))
      .send({
        guia_remision: {
          infoTributaria: { ruc: '0106079783001', claveAcceso: '', secuencial: '' },
          infoGuiaRemision: {
            fechaEmision: today,
            dirPartida: 'CUENCA',
            razonSocialTransportista: 'MONTERO CAMPOVERDE OSCAR XAVIER',
            tipoIdentificacionTransportista: '05',
            rucTransportista: '0106079783',
            fechaIniTransporte: today,
            fechaFinTransporte: today,
            placa: 'ABC1234',
          },
          destinatarios: [
            {
              destinatario: {
                identificacionDestinatario: '0106079783',
                razonSocialDestinatario: 'MONTERO CAMPOVERDE OSCAR XAVIER',
                dirDestinatario: 'CUENCA',
                motivoTraslado: 'VENTA',
                ruta: 'CUENCA - CUENCA',
                codDocSustento: '01',
                numDocSustento: '001-009-000000001',
                numAutDocSustento: '1310202601010607978300110010090000000019093224818',
                fechaEmisionDocSustento: '13/10/2026',
                detalles: [{ detalle: { codigoInterno: 'PRD001', descripcion: 'Servicio de prueba', cantidad: '1' } }],
              },
            },
          ],
        },
      });

    console.log('SRI guía de remisión:', JSON.stringify(res.body.data, null, 2));
    expect(res.status).toBe(201);
    expect(res.body.data.estado, JSON.stringify(res.body.data.mensajes)).toBe('AUTORIZADO');
    expect(res.body.data.clave_acceso).toMatch(/^\d{8}0601060797830011001013\d{9}\d{8}1\d$/);
  });
});
