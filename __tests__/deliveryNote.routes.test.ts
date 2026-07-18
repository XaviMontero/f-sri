import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/testApp';

// --- Model mocks ---
const deliveryNoteInstanceMocks = {
  save: jest.fn().mockResolvedValue({}),
};

const deliveryNoteStaticMocks = {
  find: jest.fn().mockResolvedValue([]),
  findById: jest.fn().mockResolvedValue(null),
  findOne: jest.fn().mockResolvedValue(null),
  findByIdAndUpdate: jest.fn().mockResolvedValue(null),
  findByIdAndDelete: jest.fn().mockResolvedValue(null),
};

jest.mock('../src/models/DeliveryNote', () => {
  class MockDeliveryNote {
    constructor(public data: any) {}
    save = deliveryNoteInstanceMocks.save;
    static find = (...args: any[]) => deliveryNoteStaticMocks.find(...args);
    static findById = (...args: any[]) => deliveryNoteStaticMocks.findById(...args);
    static findOne = (...args: any[]) => deliveryNoteStaticMocks.findOne(...args);
    static findByIdAndUpdate = (...args: any[]) => deliveryNoteStaticMocks.findByIdAndUpdate(...args);
    static findByIdAndDelete = (...args: any[]) => deliveryNoteStaticMocks.findByIdAndDelete(...args);
  }
  return { __esModule: true, default: MockDeliveryNote };
});

const deliveryNotePDFStaticMocks = {
  findOne: jest.fn().mockResolvedValue(null),
};

jest.mock('../src/models/DeliveryNotePDF', () => ({
  __esModule: true,
  default: {
    findOne: (...args: any[]) => deliveryNotePDFStaticMocks.findOne(...args),
  },
}));

// --- Service mock ---
const crearGuiaRemisionCompletaMock = jest.fn();
jest.mock('../src/services/delivery-note.service', () => ({
  DeliveryNoteService: {
    crearGuiaRemisionCompleta: (...args: any[]) => crearGuiaRemisionCompletaMock(...args),
  },
}));

const app = createApp();
const token = jwt.sign({ userId: '1' }, process.env.JWT_SECRET as string);
const authHeader = `Bearer ${token}`;

const guiaRemisionPayload = {
  infoTributaria: { ruc: '1790012345001' },
  infoGuiaRemision: {
    fechaEmision: '17/05/2025',
    dirPartida: 'Av. Eloy Alfaro 34',
    razonSocialTransportista: 'Transportes S.A.',
    tipoIdentificacionTransportista: '04',
    rucTransportista: '1796875790001',
    fechaIniTransporte: '17/05/2025',
    fechaFinTransporte: '18/05/2025',
    placa: 'MCL0827',
  },
  destinatarios: [],
};

describe('Delivery note routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/delivery-note/complete', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/v1/delivery-note/complete').send({});
      expect(res.status).toBe(401);
    });

    it('returns 400 when guia_remision is missing', async () => {
      const res = await request(app).post('/api/v1/delivery-note/complete').set('Authorization', authHeader).send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(crearGuiaRemisionCompletaMock).not.toHaveBeenCalled();
    });

    it('creates a complete delivery note and returns its XML', async () => {
      const resultadoMock = {
        guia_remision: { secuencial: '000000001', clave_acceso: '123' },
        xml: '<guiaRemision/>',
        xml_firmado: null,
        respuesta_sri: null,
      };
      crearGuiaRemisionCompletaMock.mockResolvedValueOnce(resultadoMock);

      const res = await request(app)
        .post('/api/v1/delivery-note/complete')
        .set('Authorization', authHeader)
        .send({ guia_remision: guiaRemisionPayload });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.xml).toBe('<guiaRemision/>');
      expect(crearGuiaRemisionCompletaMock).toHaveBeenCalledWith(guiaRemisionPayload);
    });

    it('returns 400 for validation errors from the service', async () => {
      crearGuiaRemisionCompletaMock.mockRejectedValueOnce(
        new Error('Datos de guía de remisión inválidos o incompletos'),
      );

      const res = await request(app)
        .post('/api/v1/delivery-note/complete')
        .set('Authorization', authHeader)
        .send({ guia_remision: guiaRemisionPayload });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('inválidos');
    });

    it('returns 500 for unexpected service errors', async () => {
      crearGuiaRemisionCompletaMock.mockRejectedValueOnce(new Error('mongo down'));

      const res = await request(app)
        .post('/api/v1/delivery-note/complete')
        .set('Authorization', authHeader)
        .send({ guia_remision: guiaRemisionPayload });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('CRUD endpoints', () => {
    it('lists delivery notes', async () => {
      deliveryNoteStaticMocks.find.mockResolvedValueOnce([{ secuencial: '000000001' }]);

      const res = await request(app).get('/api/v1/delivery-note').set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('returns 404 for a missing delivery note', async () => {
      const res = await request(app)
        .get('/api/v1/delivery-note/507f1f77bcf86cd799439011')
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('returns a delivery note by id', async () => {
      deliveryNoteStaticMocks.findById.mockResolvedValueOnce({ secuencial: '000000001' });

      const res = await request(app)
        .get('/api/v1/delivery-note/507f1f77bcf86cd799439011')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.secuencial).toBe('000000001');
    });

    it('returns the PDF info of a delivery note', async () => {
      deliveryNotePDFStaticMocks.findOne.mockResolvedValueOnce({ pdf_url: 'https://cdn/pdf.pdf', estado: 'GENERADO' });

      const res = await request(app)
        .get('/api/v1/delivery-note/507f1f77bcf86cd799439011/pdf')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.pdf_url).toBe('https://cdn/pdf.pdf');
    });

    it('deletes a delivery note', async () => {
      deliveryNoteStaticMocks.findByIdAndDelete.mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011' });

      const res = await request(app)
        .delete('/api/v1/delivery-note/507f1f77bcf86cd799439011')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Deleted');
    });
  });
});
