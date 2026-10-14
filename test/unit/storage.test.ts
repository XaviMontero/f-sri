import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalPDFStorage } from '../../src/services/storage/local.storage';
import { CloudinaryPDFStorage } from '../../src/services/storage/cloudinary.storage';
import { PDFStorageFactory } from '../../src/services/storage/storage.factory';
import fs from 'fs';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';

// Mock cloudinary
vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload_stream: vi.fn(),
      destroy: vi.fn(),
    },
    url: vi.fn((publicId) => `https://res.cloudinary.com/test/${publicId}`),
  },
}));

describe('LocalPDFStorage', () => {
  let storage: LocalPDFStorage;
  const testBuffer = Buffer.from('test pdf content');
  const testFilename = 'test_invoice_12345';

  beforeEach(() => {
    storage = new LocalPDFStorage();
  });

  afterEach(() => {
    // Cleanup: remove test files
    try {
      const sanitizedFilename = testFilename.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const storagePath = process.env.PDF_STORAGE_PATH || path.join(process.cwd(), 'storage', 'pdfs');
      const filePath = path.join(storagePath, `${sanitizedFilename}.pdf`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('upload', () => {
    it('should upload PDF to local storage', async () => {
      const result = await storage.upload(testBuffer, testFilename);

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('publicId');
      expect(result).toHaveProperty('size');
      expect(result).toHaveProperty('provider');
      expect(result.provider).toBe('local');
      expect(result.size).toBe(testBuffer.length);
      expect(result.publicId).toBe(testFilename.replace(/[^a-zA-Z0-9_\-]/g, '_'));
    });

    it('should sanitize filename', async () => {
      const unsafeFilename = 'test/../../etc/passwd';
      const result = await storage.upload(testBuffer, unsafeFilename);

      expect(result.publicId).not.toContain('/');
      expect(result.publicId).not.toContain('.');
      // Should replace all non-alphanumeric chars with underscores
      expect(result.publicId).toMatch(/^[a-zA-Z0-9_]+$/);
    });

    it('should create storage directory if it does not exist', async () => {
      const storagePath = process.env.PDF_STORAGE_PATH || path.join(process.cwd(), 'storage', 'pdfs');
      expect(fs.existsSync(storagePath)).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete existing PDF', async () => {
      // First upload
      const uploadResult = await storage.upload(testBuffer, testFilename);

      // Then delete
      const deleted = await storage.delete(uploadResult.publicId);

      expect(deleted).toBe(true);
    });

    it('should return false when deleting non-existent PDF', async () => {
      const deleted = await storage.delete('non_existent_file');

      expect(deleted).toBe(false);
    });
  });

  describe('getPublicUrl', () => {
    it('should return correct public URL', () => {
      const publicId = 'test_invoice';
      const url = storage.getPublicUrl(publicId);

      expect(url).toContain('test_invoice.pdf');
      expect(url).toContain(process.env.PDF_BASE_URL || 'http://localhost:3000/pdfs');
    });
  });

  describe('getProviderName', () => {
    it('should return local as provider name', () => {
      expect(storage.getProviderName()).toBe('local');
    });
  });

  describe('getFileInfo', () => {
    it('should return file info for existing file', async () => {
      const uploadResult = await storage.upload(testBuffer, testFilename);
      const info = storage.getFileInfo(uploadResult.publicId);

      expect(info.exists).toBe(true);
      expect(info.size).toBe(testBuffer.length);
      expect(info.path).toBeDefined();
    });

    it('should return exists false for non-existent file', () => {
      const info = storage.getFileInfo('non_existent');

      expect(info.exists).toBe(false);
      expect(info.size).toBeUndefined();
      expect(info.path).toBeUndefined();
    });
  });
});

describe('CloudinaryPDFStorage', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Set test credentials
    process.env.CLOUDINARY_CLOUD_NAME = 'test_cloud';
    process.env.CLOUDINARY_API_KEY = 'test_key';
    process.env.CLOUDINARY_API_SECRET = 'test_secret';
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should configure cloudinary with credentials', () => {
      new CloudinaryPDFStorage();

      expect(cloudinary.config).toHaveBeenCalledWith({
        cloud_name: 'test_cloud',
        api_key: 'test_key',
        api_secret: 'test_secret',
      });
    });

    it('should throw error when credentials are missing', () => {
      delete process.env.CLOUDINARY_CLOUD_NAME;

      expect(() => new CloudinaryPDFStorage()).toThrow('Cloudinary credentials are required');
    });

    it('should throw error when CLOUDINARY_API_KEY is missing', () => {
      delete process.env.CLOUDINARY_API_KEY;

      expect(() => new CloudinaryPDFStorage()).toThrow('Cloudinary credentials are required');
    });

    it('should throw error when CLOUDINARY_API_SECRET is missing', () => {
      delete process.env.CLOUDINARY_API_SECRET;

      expect(() => new CloudinaryPDFStorage()).toThrow('Cloudinary credentials are required');
    });
  });

  describe('upload', () => {
    it('should upload PDF to cloudinary', async () => {
      const mockResult = {
        secure_url: 'https://res.cloudinary.com/test/facturas/test.pdf',
        public_id: 'facturas/test_invoice',
        bytes: 1234,
      };

      // Mock upload_stream to simulate a writable stream
      vi.mocked(cloudinary.uploader.upload_stream).mockImplementation(((_options: any, callback: any) => {
        // Call callback immediately to simulate successful upload
        setImmediate(() => callback(null, mockResult));

        // Return a mock writable stream
        return {
          write: vi.fn(),
          end: vi.fn(),
          on: vi.fn(),
          once: vi.fn(),
          emit: vi.fn(),
        };
      }) as any);

      const storage = new CloudinaryPDFStorage();
      const testBuffer = Buffer.from('test pdf');

      const result = await storage.upload(testBuffer, 'test_invoice');

      expect(result).toEqual({
        url: mockResult.secure_url,
        publicId: mockResult.public_id,
        size: mockResult.bytes,
        provider: 'cloudinary',
      });
    });

    it('should throw error when upload fails', async () => {
      vi.mocked(cloudinary.uploader.upload_stream).mockImplementation(((_options: any, callback: any) => {
        setImmediate(() => callback(new Error('Upload failed'), null));

        return {
          write: vi.fn(),
          end: vi.fn(),
          on: vi.fn(),
          once: vi.fn(),
          emit: vi.fn(),
        };
      }) as any);

      const storage = new CloudinaryPDFStorage();
      const testBuffer = Buffer.from('test pdf');

      await expect(storage.upload(testBuffer, 'test_invoice')).rejects.toThrow('Error subiendo PDF a Cloudinary');
    });
  });

  describe('delete', () => {
    it('should delete PDF from cloudinary', async () => {
      vi.mocked(cloudinary.uploader.destroy).mockResolvedValue({ result: 'ok' });

      const storage = new CloudinaryPDFStorage();
      const result = await storage.delete('facturas/test_invoice');

      expect(result).toBe(true);
      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('facturas/test_invoice', {
        resource_type: 'raw',
      });
    });

    it('should return false when deletion fails', async () => {
      vi.mocked(cloudinary.uploader.destroy).mockResolvedValue({ result: 'not found' });

      const storage = new CloudinaryPDFStorage();
      const result = await storage.delete('facturas/non_existent');

      expect(result).toBe(false);
    });

    it('should return false when deletion throws error', async () => {
      vi.mocked(cloudinary.uploader.destroy).mockRejectedValue(new Error('Network error'));

      const storage = new CloudinaryPDFStorage();
      const result = await storage.delete('facturas/test_invoice');

      expect(result).toBe(false);
    });
  });

  describe('getPublicUrl', () => {
    it('should return cloudinary URL', () => {
      const storage = new CloudinaryPDFStorage();

      storage.getPublicUrl('facturas/test_invoice');

      expect(cloudinary.url).toHaveBeenCalledWith('facturas/test_invoice', {
        resource_type: 'raw',
        format: 'pdf',
        secure: true,
      });
    });
  });

  describe('getProviderName', () => {
    it('should return cloudinary as provider name', () => {
      const storage = new CloudinaryPDFStorage();
      expect(storage.getProviderName()).toBe('cloudinary');
    });
  });

  describe('extractPublicIdFromUrl', () => {
    it('should extract public_id from cloudinary URL', () => {
      const url = 'https://res.cloudinary.com/demo/upload/v1234567/facturas/invoice_001.pdf';
      const publicId = CloudinaryPDFStorage.extractPublicIdFromUrl(url);

      expect(publicId).toBe('facturas/invoice_001');
    });

    it('should throw error for invalid URL', () => {
      expect(() => CloudinaryPDFStorage.extractPublicIdFromUrl('invalid-url')).toThrow();
    });

    it('should throw error for non-cloudinary URL', () => {
      const url = 'https://example.com/file.pdf';
      expect(() => CloudinaryPDFStorage.extractPublicIdFromUrl(url)).toThrow();
    });
  });
});

describe('PDFStorageFactory', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    PDFStorageFactory.reset();
  });

  afterEach(() => {
    process.env = originalEnv;
    PDFStorageFactory.reset();
  });

  describe('create', () => {
    it('should create local storage by default', () => {
      delete process.env.PDF_STORAGE_PROVIDER;

      const storage = PDFStorageFactory.create();

      expect(storage.getProviderName()).toBe('local');
    });

    it('should create cloudinary storage when configured', () => {
      process.env.PDF_STORAGE_PROVIDER = 'cloudinary';
      process.env.CLOUDINARY_CLOUD_NAME = 'test';
      process.env.CLOUDINARY_API_KEY = 'key';
      process.env.CLOUDINARY_API_SECRET = 'secret';

      const storage = PDFStorageFactory.create();

      expect(storage.getProviderName()).toBe('cloudinary');
    });

    it('should create local storage when requested explicitly', () => {
      const storage = PDFStorageFactory.create('local');

      expect(storage.getProviderName()).toBe('local');
    });

    it('should return same instance on multiple calls (singleton)', () => {
      const storage1 = PDFStorageFactory.create('local');
      const storage2 = PDFStorageFactory.create('local');

      expect(storage1).toBe(storage2);
    });

    it('should create fresh instance when forceFresh is true', () => {
      const storage1 = PDFStorageFactory.create('local');
      const storage2 = PDFStorageFactory.create('local', true);

      expect(storage1).not.toBe(storage2);
    });

    it('should fallback to local for s3 (not implemented)', () => {
      const storage = PDFStorageFactory.create('s3');

      expect(storage.getProviderName()).toBe('local');
    });

    it('should fallback to local for azure (not implemented)', () => {
      const storage = PDFStorageFactory.create('azure');

      expect(storage.getProviderName()).toBe('local');
    });

    it('should fallback to local for unknown provider', () => {
      const storage = PDFStorageFactory.create('unknown' as any);

      expect(storage.getProviderName()).toBe('local');
    });
  });

  describe('getConfiguredProviderType', () => {
    it('should return configured provider type', () => {
      process.env.PDF_STORAGE_PROVIDER = 'cloudinary';

      const type = PDFStorageFactory.getConfiguredProviderType();

      expect(type).toBe('cloudinary');
    });

    it('should return local as default', () => {
      delete process.env.PDF_STORAGE_PROVIDER;

      const type = PDFStorageFactory.getConfiguredProviderType();

      expect(type).toBe('local');
    });
  });

  describe('isProviderSupported', () => {
    it('should return true for cloudinary', () => {
      expect(PDFStorageFactory.isProviderSupported('cloudinary')).toBe(true);
    });

    it('should return true for local', () => {
      expect(PDFStorageFactory.isProviderSupported('local')).toBe(true);
    });

    it('should return false for s3', () => {
      expect(PDFStorageFactory.isProviderSupported('s3')).toBe(false);
    });

    it('should return false for unknown provider', () => {
      expect(PDFStorageFactory.isProviderSupported('unknown')).toBe(false);
    });
  });

  describe('getAvailableProviders', () => {
    it('should return list of available providers', () => {
      const providers = PDFStorageFactory.getAvailableProviders();

      expect(providers).toHaveLength(4);
      expect(providers[0].type).toBe('cloudinary');
      expect(providers[0].implemented).toBe(true);
      expect(providers[1].type).toBe('local');
      expect(providers[1].implemented).toBe(true);
      expect(providers[2].type).toBe('s3');
      expect(providers[2].implemented).toBe(false);
      expect(providers[3].type).toBe('azure');
      expect(providers[3].implemented).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset singleton instance', () => {
      const storage1 = PDFStorageFactory.create('local');
      PDFStorageFactory.reset();
      const storage2 = PDFStorageFactory.create('local');

      expect(storage1).not.toBe(storage2);
    });
  });
});
