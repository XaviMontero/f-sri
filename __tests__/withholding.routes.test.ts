import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/testApp';

// --- Model mocks ---
const withholdingInstanceMocks = {
  save: jest.fn().mockResolvedValue({}),
};

const withholdingStaticMocks = {
  find: jest.fn().mockResolvedValue([]),
  findById: jest.fn().mockResolvedValue(null),
  findOne: jest.fn().mockResolvedValue(null),
  findByIdAndUpdate: jest.fn().mockResolvedValue(null),
  findByIdAndDelete: jest.fn().mockResolvedValue(null),
};

jest.mock('../src/models/Withholding', () => {
  class MockWithholding {
    constructor(public data: any) {}
    save = withholdingInstanceMocks.save;
    static find = (...args: any[]) => withholdingStaticMocks.find(...args);
    static findById = (...args: any[]) => withholdingStaticMocks.findById(...args);
    static findOne = (...args: any[]) => withholdingStaticMocks.findOne(...args);
    static findByIdAndUpdate = (...args: any[]) => withholdingStaticMocks.findByIdAndUpdate(...args);
    static findByIdAndDelete = (...args: any[]) => withholdingStaticMocks.findByIdAndDelete(...args);
  }
  return { __esModule: true, default: MockWithholding };
});

const withholdingPDFStaticMocks = {
  findOne: jest.fn().mockResolvedValue(null),
};

jest.mock('../src/models/WithholdingPDF', () => ({
  __esModule: true,
  default: {
    findOne: (...args: any[]) => withholdingPDFStaticMocks.findOne(...args),
  },
}));

// --- Service mock ---
const crearRetencionCompletaMock = jest.fn();
jest.mock('../src/services/withholding.service', () => ({
  WithholdingService: {
    crearRetencionCompleta: (...args: any[]) => crearRetencionCompletaMock(...args),
  },
}));

const app = createApp();
const token = jwt.sign({ userId: '1' }, process.env.JWT_SECRET as string);
const authHeader = `Bearer ${token}`;

const retencionPayload = {
  infoTributaria: { ruc: '1790012345001' },
  infoCompRetencion: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionSujetoRetenido: '04',
    razonSocialSujetoRetenido: 'Proveedor S.A.',
    identificacionSujetoRetenido: '1713328506001',
    periodoFiscal: '05/2025',
  },
  docsSustento: [],
};

describe('Withholding routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/withholding/complete', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/v1/withholding/complete').send({});
      expect(res.status).toBe(401);
    });

    it('returns 400 when retencion is missing', async () => {
      const res = await request(app).post('/api/v1/withholding/complete').set('Authorization', authHeader).send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(crearRetencionCompletaMock).not.toHaveBeenCalled();
    });

    it('creates a complete withholding and returns its XML', async () => {
      const resultadoMock = {
        retencion: { secuencial: '000000001', clave_acceso: '123' },
        xml: '<comprobanteRetencion/>',
        xml_firmado: null,
        respuesta_sri: null,
      };
      crearRetencionCompletaMock.mockResolvedValueOnce(resultadoMock);

      const res = await request(app)
        .post('/api/v1/withholding/complete')
        .set('Authorization', authHeader)
        .send({ retencion: retencionPayload });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.xml).toBe('<comprobanteRetencion/>');
      expect(crearRetencionCompletaMock).toHaveBeenCalledWith(retencionPayload);
    });

    it('returns 400 for validation errors from the service', async () => {
      crearRetencionCompletaMock.mockRejectedValueOnce(
        new Error('Datos de comprobante de retención inválidos o incompletos'),
      );

      const res = await request(app)
        .post('/api/v1/withholding/complete')
        .set('Authorization', authHeader)
        .send({ retencion: retencionPayload });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('inválidos');
    });

    it('returns 500 for unexpected service errors', async () => {
      crearRetencionCompletaMock.mockRejectedValueOnce(new Error('mongo down'));

      const res = await request(app)
        .post('/api/v1/withholding/complete')
        .set('Authorization', authHeader)
        .send({ retencion: retencionPayload });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('CRUD endpoints', () => {
    it('lists withholdings', async () => {
      withholdingStaticMocks.find.mockResolvedValueOnce([{ secuencial: '000000001' }]);

      const res = await request(app).get('/api/v1/withholding').set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('returns 404 for a missing withholding', async () => {
      const res = await request(app)
        .get('/api/v1/withholding/507f1f77bcf86cd799439011')
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('returns a withholding by id', async () => {
      withholdingStaticMocks.findById.mockResolvedValueOnce({ secuencial: '000000001' });

      const res = await request(app)
        .get('/api/v1/withholding/507f1f77bcf86cd799439011')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.secuencial).toBe('000000001');
    });

    it('returns the PDF info of a withholding', async () => {
      withholdingPDFStaticMocks.findOne.mockResolvedValueOnce({ pdf_url: 'https://cdn/pdf.pdf', estado: 'GENERADO' });

      const res = await request(app)
        .get('/api/v1/withholding/507f1f77bcf86cd799439011/pdf')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.pdf_url).toBe('https://cdn/pdf.pdf');
    });

    it('deletes a withholding', async () => {
      withholdingStaticMocks.findByIdAndDelete.mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011' });

      const res = await request(app)
        .delete('/api/v1/withholding/507f1f77bcf86cd799439011')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Deleted');
    });
  });
});
