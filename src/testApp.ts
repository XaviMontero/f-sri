import express from 'express';
import authRoutes from './routes/auth';
import identificationTypeRoutes from './routes/identificationType';
import issuingCompanyRoutes from './routes/issuingCompany';
import clientRoutes from './routes/client';
import productRoutes from './routes/product';
import invoiceRoutes from './routes/invoice';
import creditNoteRoutes from './routes/creditNote';
import debitNoteRoutes from './routes/debitNote';
import deliveryNoteRoutes from './routes/deliveryNote';
import withholdingRoutes from './routes/withholding';
import invoiceDetailRoutes from './routes/invoiceDetail';
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
  app.use('/api/v1/credit-note', creditNoteRoutes);
  app.use('/api/v1/debit-note', debitNoteRoutes);
  app.use('/api/v1/delivery-note', deliveryNoteRoutes);
  app.use('/api/v1/withholding', withholdingRoutes);
  app.use('/api/v1/invoice-detail', invoiceDetailRoutes);
  return app;
}
