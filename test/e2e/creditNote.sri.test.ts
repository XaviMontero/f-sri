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
import { createCreditNoteModule } from '../../src/modules/creditNote';
import { encrypt } from '../../src/utils/encryption.utils';

/**
 * E2E contra el ambiente de PRUEBAS real del SRI (opt-in):
 *
 *   SRI_E2E_P12=/ruta/al/certificado.p12 SRI_E2E_PASSWORD=*** \
 *     npx vitest run test/e2e/creditNote.sri.test.ts
 *
 * Emite una nota de crédito (ptoEmi 011) que modifica la factura 001-009-000000001 del
 * 13/10/2026, ya AUTORIZADA en pruebas. El secuencial parte de SRI_E2E_LAST_SEQUENTIAL_04 o,
 * por defecto, de un valor derivado de la hora (evita el error 45 "secuencial registrado").
 */
const P12 = process.env.SRI_E2E_P12;

function lastSequential(): number {
  const declared = Number(process.env.SRI_E2E_LAST_SEQUENTIAL_04);
  return Number.isInteger(declared) && declared >= 0 ? declared : Math.floor(Date.now() / 1000) % 900_000_000;
}

describe.skipIf(!P12)('E2E SRI pruebas: nota de crédito (codDoc 04)', () => {
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
      punto_emision: '011',
      tipo_ambiente: 1,
      tipo_emision: 1,
      obligado_contabilidad: false,
      certificate: readFileSync(P12!).toString('base64'),
      certificate_password: encrypt(process.env.SRI_E2E_PASSWORD ?? ''),
      // Cada corrida usa un secuencial nuevo: el SRI rechaza (error 45) los ya registrados en pruebas.
      ultimos_secuenciales: { '04': lastSequential() },
      user_id: new Types.ObjectId(),
    });
    companyId = String(company._id);
  });
  afterAll(stopMongo);

  it('el SRI AUTORIZA la nota de crédito', { timeout: 120000 }, async () => {
    const app = moduleApp(
      createCreditNoteModule({
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
      .post('/api/v1/credit-note/complete?esperar=true')
      .set(authFor(companyId))
      .send({
        nota_credito: {
          infoTributaria: { ruc: '0106079783001', claveAcceso: '', secuencial: '' },
          infoNotaCredito: {
            fechaEmision: EmissionDate.todayInEcuador().toSriFormat(),
            tipoIdentificacionComprador: '05',
            identificacionComprador: '0106079783',
            razonSocialComprador: 'MONTERO CAMPOVERDE OSCAR XAVIER',
            codDocModificado: '01',
            numDocModificado: '001-009-000000001',
            fechaEmisionDocSustento: '13/10/2026',
            totalSinImpuestos: '10.00',
            valorModificacion: '11.50',
            moneda: 'DOLAR',
            motivo: 'DEVOLUCION DE PRUEBA',
          },
          detalles: [
            {
              detalle: {
                codigoInterno: 'PRD001',
                descripcion: 'Servicio de prueba',
                cantidad: '1',
                precioUnitario: '10.00',
                descuento: '0.00',
                precioTotalSinImpuesto: '10.00',
                impuestos: [{ impuesto: { codigo: '2', codigoPorcentaje: '4', tarifa: '15' } }],
              },
            },
          ],
          infoAdicional: { Email: 'xavier.montero@example.com' },
        },
      });

    console.log('Respuesta SRI (nota de crédito):', JSON.stringify(res.body.data, null, 2));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.estado, JSON.stringify(res.body.data.mensajes)).toBe('AUTORIZADO');
    expect(res.body.data.clave_acceso).toMatch(/^\d{49}$/);
  });
});
