import express from 'express';
import authRoutes from './routes/auth';
import identificationTypeRoutes from './routes/identificationType';
import issuingCompanyRoutes from './routes/issuingCompany';
import clientRoutes from './routes/client';
import productRoutes from './routes/product';
import invoiceRoutes from './routes/invoice';
import invoiceDetailRoutes from './routes/invoiceDetail';
import debitNoteRoutes from './routes/debitNote';
import verifyToken from './middleware/verifyToken';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(authRoutes);
  app.use(verifyToken);
  app.use('/api/v1/identification-type', identificationTypeRoutes);
  app.use('/api/v1/issuing-company', issuingCompanyRoutes);
  app.use('/api/v1/client', clientRoutes);
  app.use('/api/v1/product', productRoutes);
  app.use('/api/v1/invoice', invoiceRoutes);
  app.use('/api/v1/invoice-detail', invoiceDetailRoutes);
  app.use('/api/v1/debit-note', debitNoteRoutes);
  return app;
}
