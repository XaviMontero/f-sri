const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'msg-123' });

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(() => ({ sendMail: sendMailMock })),
  },
}));

import nodemailer from 'nodemailer';
import {
  generateInvoiceEmailTemplate,
  prepareEmailConfig,
  isValidEmail,
  sendInvoiceEmail,
} from '../../src/utils/email.utils';

const invoicePDFMock: any = {
  claveAcceso: '1705202501179001234500110010010000000011234567810',
  numero_autorizacion: '1705202501179001234500110010010000000011234567810',
  fecha_autorizacion: new Date('2025-05-17T12:00:00Z'),
  fecha_generacion: new Date('2025-05-17T12:05:00Z'),
  pdf_url: 'https://cdn.example.com/factura.pdf',
};

describe('isValidEmail', () => {
  it('accepts valid emails', () => {
    expect(isValidEmail('cliente@test.com')).toBe(true);
    expect(isValidEmail('a.b+c@sub.dominio.ec')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(isValidEmail('no-arroba')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('generateInvoiceEmailTemplate', () => {
  it('builds subject, html and text with the invoice data', () => {
    const template = generateInvoiceEmailTemplate(invoicePDFMock, 'Juan Pérez', 'EMPRESA DEMO S.A.');

    expect(template.subject).toContain(invoicePDFMock.claveAcceso);
    expect(template.html).toContain('Juan Pérez');
    expect(template.html).toContain('EMPRESA DEMO S.A.');
    expect(template.html).toContain(invoicePDFMock.pdf_url);
    expect(template.text).toContain(invoicePDFMock.claveAcceso);
    expect(template.text).toContain(invoicePDFMock.pdf_url);
  });

  it('throws when the PDF URL is missing', () => {
    expect(() => generateInvoiceEmailTemplate({ ...invoicePDFMock, pdf_url: '' }, 'Juan', 'Empresa')).toThrow(
      'PDF URL no disponible',
    );
  });
});

describe('prepareEmailConfig', () => {
  it('maps the template into a sendable config without attachments', () => {
    const template = { subject: 's', html: '<p>h</p>', text: 't' };
    const config = prepareEmailConfig(invoicePDFMock, template, 'cliente@test.com');

    expect(config).toEqual({
      to: 'cliente@test.com',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
    });
  });
});

describe('sendInvoiceEmail', () => {
  const originalUser = process.env.EMAIL_USER;
  const originalPassword = process.env.EMAIL_PASSWORD;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EMAIL_USER = 'emisor@test.com';
    process.env.EMAIL_PASSWORD = 'test-email-password';
  });

  afterAll(() => {
    process.env.EMAIL_USER = originalUser;
    process.env.EMAIL_PASSWORD = originalPassword;
    if (originalUser === undefined) delete process.env.EMAIL_USER;
    if (originalPassword === undefined) delete process.env.EMAIL_PASSWORD;
  });

  it('sends the email and returns the messageId', async () => {
    const result = await sendInvoiceEmail(invoicePDFMock, 'cliente@test.com', 'Juan', 'Empresa');

    expect(result).toEqual({ success: true, messageId: 'msg-123' });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'emisor@test.com', pass: 'test-email-password' } }),
    );
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'emisor@test.com', to: 'cliente@test.com' }),
    );
  });

  it('fails for an invalid recipient email', async () => {
    const result = await sendInvoiceEmail(invoicePDFMock, 'invalido', 'Juan', 'Empresa');

    expect(result.success).toBe(false);
    expect(result.error).toContain('email inválido');
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('fails gracefully when email credentials are not configured', async () => {
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASSWORD;

    const result = await sendInvoiceEmail(invoicePDFMock, 'cliente@test.com', 'Juan', 'Empresa');

    expect(result.success).toBe(false);
    expect(result.error).toContain('no configurado');
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('returns the error when the transport fails', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('SMTP down'));

    const result = await sendInvoiceEmail(invoicePDFMock, 'cliente@test.com', 'Juan', 'Empresa');

    expect(result.success).toBe(false);
    expect(result.error).toBe('SMTP down');
  });
});
