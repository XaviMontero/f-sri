import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/testApp';

// --- Model mocks ---
const debitNoteInstanceMocks = {
  save: jest.fn().mockResolvedValue({}),
};

const debitNoteStaticMocks = {
  find: jest.fn().mockResolvedValue([]),
  findById: jest.fn().mockResolvedValue(null),
  findOne: jest.fn().mockResolvedValue(null),
  findByIdAndUpdate: jest.fn().mockResolvedValue(null),
  findByIdAndDelete: jest.fn().mockResolvedValue(null),
};

jest.mock('../src/models/DebitNote', () => {
  class MockDebitNote {
    constructor(public data: any) {}
    save = debitNoteInstanceMocks.save;
    static find = (...args: any[]) => debitNoteStaticMocks.find(...args);
    static findById = (...args: any[]) => debitNoteStaticMocks.findById(...args);
    static findOne = (...args: any[]) => debitNoteStaticMocks.findOne(...args);
    static findByIdAndUpdate = (...args: any[]) => debitNoteStaticMocks.findByIdAndUpdate(...args);
    static findByIdAndDelete = (...args: any[]) => debitNoteStaticMocks.findByIdAndDelete(...args);
  }
  return { __esModule: true, default: MockDebitNote };
});

const debitNotePDFStaticMocks = {
  findOne: jest.fn().mockResolvedValue(null),
};

jest.mock('../src/models/DebitNotePDF', () => ({
  __esModule: true,
  default: {
    findOne: (...args: any[]) => debitNotePDFStaticMocks.findOne(...args),
  },
}));

// --- Service mock ---
const crearNotaDebitoCompletaMock = jest.fn();
jest.mock('../src/services/debit-note.service', () => ({
  DebitNoteService: {
    crearNotaDebitoCompleta: (...args: any[]) => crearNotaDebitoCompletaMock(...args),
  },
}));

const app = createApp();
const token = jwt.sign({ userId: '1' }, process.env.JWT_SECRET as string);
const authHeader = `Bearer ${token}`;

const notaDebitoPayload = {
  infoTributaria: { ruc: '1790012345001' },
  infoNotaDebito: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionComprador: '05',
    identificacionComprador: '0106079783',
    codDocModificado: '01',
    numDocModificado: '001-001-000000123',
    fechaEmisionDocSustento: '10/05/2025',
    totalSinImpuestos: '50.00',
    impuestos: [],
    valorTotal: '57.50',
    pagos: [],
  },
  motivos: [],
};

describe('Debit note routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/debit-note/complete', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/v1/debit-note/complete').send({});
      expect(res.status).toBe(401);
    });

    it('returns 400 when nota_debito is missing', async () => {
      const res = await request(app).post('/api/v1/debit-note/complete').set('Authorization', authHeader).send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(crearNotaDebitoCompletaMock).not.toHaveBeenCalled();
    });

    it('creates a complete debit note and returns its XML', async () => {
      const resultadoMock = {
        nota_debito: { secuencial: '000000001', clave_acceso: '123' },
        xml: '<notaDebito/>',
        xml_firmado: null,
        respuesta_sri: null,
      };
      crearNotaDebitoCompletaMock.mockResolvedValueOnce(resultadoMock);

      const res = await request(app)
        .post('/api/v1/debit-note/complete')
        .set('Authorization', authHeader)
        .send({ nota_debito: notaDebitoPayload });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.xml).toBe('<notaDebito/>');
      expect(crearNotaDebitoCompletaMock).toHaveBeenCalledWith(notaDebitoPayload);
    });

    it('returns 400 for validation errors from the service', async () => {
      crearNotaDebitoCompletaMock.mockRejectedValueOnce(new Error('Datos de nota de débito inválidos o incompletos'));

      const res = await request(app)
        .post('/api/v1/debit-note/complete')
        .set('Authorization', authHeader)
        .send({ nota_debito: notaDebitoPayload });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('inválidos');
    });

    it('returns 500 for unexpected service errors', async () => {
      crearNotaDebitoCompletaMock.mockRejectedValueOnce(new Error('mongo down'));

      const res = await request(app)
        .post('/api/v1/debit-note/complete')
        .set('Authorization', authHeader)
        .send({ nota_debito: notaDebitoPayload });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('CRUD endpoints', () => {
    it('lists debit notes', async () => {
      debitNoteStaticMocks.find.mockResolvedValueOnce([{ secuencial: '000000001' }]);

      const res = await request(app).get('/api/v1/debit-note').set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('returns 404 for a missing debit note', async () => {
      const res = await request(app)
        .get('/api/v1/debit-note/507f1f77bcf86cd799439011')
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('returns a debit note by id', async () => {
      debitNoteStaticMocks.findById.mockResolvedValueOnce({ secuencial: '000000001' });

      const res = await request(app)
        .get('/api/v1/debit-note/507f1f77bcf86cd799439011')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.secuencial).toBe('000000001');
    });

    it('returns the PDF info of a debit note', async () => {
      debitNotePDFStaticMocks.findOne.mockResolvedValueOnce({ pdf_url: 'https://cdn/pdf.pdf', estado: 'GENERADO' });

      const res = await request(app)
        .get('/api/v1/debit-note/507f1f77bcf86cd799439011/pdf')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.pdf_url).toBe('https://cdn/pdf.pdf');
    });

    it('deletes a debit note', async () => {
      debitNoteStaticMocks.findByIdAndDelete.mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011' });

      const res = await request(app)
        .delete('/api/v1/debit-note/507f1f77bcf86cd799439011')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Deleted');
    });
  });
});
