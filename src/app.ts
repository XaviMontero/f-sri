import express from 'express';
import path from 'path';
import cors from 'cors';
import { getCorsConfig } from './config/cors.config';
import swaggerSpec from './swagger';
import authRoutes from './routes/auth';
import corsTestRoutes from './routes/cors-test';
import identificationTypeRoutes from './routes/identificationType';
import issuingCompanyRoutes from './routes/issuingCompany';
import clientRoutes from './routes/client';
import productRoutes from './routes/product';
import { createInvoiceRouter } from './routes/invoice';
import invoiceDetailRoutes from './routes/invoiceDetail';
import { createInvoicePdfRouter } from './routes/invoicePDF';
import verifyToken from './middleware/verifyToken';
import corsErrorHandler from './middleware/corsErrorHandler';
import { errorHandler } from './http/errorHandler';
import { Container } from './container';

const swaggerHtml = `<!DOCTYPE html>
<html>
<head>
  <title>API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@4.18.3/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@4.18.3/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({ url: '/swagger.json', dom_id: '#swagger-ui' });
    };
  </script>
</body>
</html>`;

/** Construye la aplicación Express con las dependencias inyectadas (sin abrir puertos ni conexiones). */
export function createApp(container: Container) {
  const app = express();

  app.use(cors(getCorsConfig()));
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    next();
  });
  // Los .p12 viajan en base64 dentro del JSON de registro: el límite por defecto (100kb) puede quedarse corto.
  app.use(express.json({ limit: '2mb' }));

  // Rutas públicas
  if ((process.env.PDF_STORAGE_PROVIDER || 'local') === 'local') {
    // Las URLs del almacenamiento local apuntan aquí (PDF_BASE_URL); el nombre incluye la clave de acceso.
    app.use('/pdfs', express.static(path.resolve(process.env.PDF_STORAGE_PATH || 'storage/pdfs'), { index: false }));
  }
  app.use(authRoutes);
  app.use(corsTestRoutes);
  const spec = {
    ...swaggerSpec,
    paths: Object.assign({}, swaggerSpec.paths, ...container.modules.map((m) => m.swaggerPaths ?? {})),
  };
  app.get('/swagger.json', (_req, res) => {
    res.json(spec);
  });
  app.get('/docs', (_req, res) => {
    res.type('html').send(swaggerHtml);
  });
  app.get('/health', (_req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString(), environment: process.env.NODE_ENV || 'development' });
  });

  // Rutas protegidas
  app.use(verifyToken);
  app.use('/api/v1/identification-type', identificationTypeRoutes);
  app.use('/api/v1/issuing-company', issuingCompanyRoutes);
  app.use('/api/v1/client', clientRoutes);
  app.use('/api/v1/product', productRoutes);
  app.use('/api/v1/invoice', createInvoiceRouter(container));
  app.use('/api/v1/invoice-detail', invoiceDetailRoutes);
  app.use('/api/v1/invoice-pdf', createInvoicePdfRouter(container));
  for (const module of container.modules) {
    app.use(`/api/v1/${module.path}`, module.router);
  }

  app.use(corsErrorHandler);
  app.use(errorHandler);
  return app;
}
