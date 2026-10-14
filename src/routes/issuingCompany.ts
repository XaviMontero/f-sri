import { Request, Router } from 'express';
import IssuingCompany from '../models/IssuingCompany';
import { encrypt } from '../utils/encryption.utils';
import { asyncHandler } from '../http/errorHandler';
import { companyIdOf } from '../http/tenant';
import { NotFoundError } from '../domain/shared/errors';

const router = Router();

/** Campos que el emisor no puede cambiar por esta ruta (identidad y propiedad). */
const IMMUTABLE_FIELDS = ['_id', 'ruc', 'user_id', 'certificatePath', 'createdAt', 'updatedAt'];

/** Solo la propia empresa: cualquier otro id responde 404 para no revelar su existencia. */
function ownCompanyId(req: Request): string {
  const companyId = companyIdOf(req);
  if (req.params.id && req.params.id !== companyId) throw new NotFoundError('Not found');
  return companyId;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await IssuingCompany.find({ _id: companyIdOf(req) }));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await IssuingCompany.findById(ownCompanyId(req));
    if (!doc) throw new NotFoundError('Not found');
    res.json(doc);
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = ownCompanyId(req);
    // `certificatePath` ya no se acepta: permitía leer archivos arbitrarios del servidor.
    const { certificate, certificatePassword, certificate_password, ...rest } = req.body ?? {};
    for (const field of IMMUTABLE_FIELDS) delete rest[field];

    const update: Record<string, unknown> = { ...rest };
    if (certificate) update.certificate = certificate;
    const password = certificate_password || certificatePassword;
    if (password) update.certificate_password = encrypt(password);

    const doc = await IssuingCompany.findByIdAndUpdate(id, update, { new: true, runValidators: true });
    if (!doc) throw new NotFoundError('Not found');
    res.json(doc);
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const doc = await IssuingCompany.findByIdAndDelete(ownCompanyId(req));
    if (!doc) throw new NotFoundError('Not found');
    res.json({ message: 'Deleted' });
  }),
);

export default router;
