import fs from 'fs';
import { LocalPDFStorage } from '../../src/services/storage/local.storage';

/**
 * Error-path coverage for LocalPDFStorage: filesystem failures must be
 * reported cleanly instead of crashing the invoicing flow.
 */
describe('LocalPDFStorage error handling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws a descriptive error when the storage directory cannot be created', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => new LocalPDFStorage()).toThrow('No se pudo crear el directorio de almacenamiento');
  });

  it('throws a descriptive error when writing the PDF fails', async () => {
    const storage = new LocalPDFStorage();
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    await expect(storage.upload(Buffer.from('pdf'), 'factura_test')).rejects.toThrow('Error guardando PDF localmente');
  });

  it('returns false when deleting a PDF fails', async () => {
    const storage = new LocalPDFStorage();
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw new Error('EBUSY: resource busy');
    });

    await expect(storage.delete('factura_test.pdf')).resolves.toBe(false);
  });

  it('reports exists false when reading file info fails', () => {
    const storage = new LocalPDFStorage();
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('EIO: i/o error');
    });

    expect(storage.getFileInfo('factura_test.pdf')).toEqual({ exists: false });
  });
});
