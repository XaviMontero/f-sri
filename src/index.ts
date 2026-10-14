import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { createApp } from './app';
import { createContainer } from './container';

const PORT = process.env.PORT || 3000;

async function main(): Promise<void> {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET es obligatorio');
  if (!process.env.ENCRYPTION_KEY)
    throw new Error('ENCRYPTION_KEY es obligatorio (cifra las contraseñas de los certificados)');

  await mongoose.connect(process.env.MONGO_URI || '');
  const app = createApp(createContainer());
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📄 API Docs: http://localhost:${PORT}/docs`);
  });
}

main().catch((err) => {
  console.error('❌ No se pudo iniciar el servidor', err);
  process.exit(1);
});
