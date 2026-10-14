import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import IssuingCompany from '../models/IssuingCompany';
import { encrypt } from '../utils/encryption.utils';

const router = Router();

/**
 * Validates RUC format for Ecuador
 */
function isValidRUC(ruc: string): boolean {
  // RUC debe tener 13 dígitos y terminar en 001
  const rucRegex = /^\d{10}001$/;
  return rucRegex.test(ruc);
}

/**
 * Check if this is the first registration in the system
 */
async function isFirstRegistration(): Promise<boolean> {
  const userCount = await User.countDocuments();
  const companyCount = await IssuingCompany.countDocuments();
  return userCount === 0 && companyCount === 0;
}

/**
 * Validates registration security requirements
 */
async function validateRegistrationSecurity(req: any): Promise<{ valid: boolean; error?: string }> {
  const { masterKey, invitationCode, ruc } = req.body;

  // Check if it's the first registration
  const isFirst = await isFirstRegistration();

  if (isFirst) {
    // First registration: require master key
    const requiredMasterKey = process.env.MASTER_REGISTRATION_KEY;
    if (!requiredMasterKey) {
      return { valid: false, error: 'Sistema no configurado para registro inicial' };
    }
    if (masterKey !== requiredMasterKey) {
      return { valid: false, error: 'Clave maestra requerida para el primer registro' };
    }
  } else {
    // Subsequent registrations: require invitation code or whitelist
    const allowedRUCs = process.env.ALLOWED_RUCS?.split(',').map((r) => r.trim()) || [];
    const validInvitationCodes = process.env.INVITATION_CODES?.split(',').map((c) => c.trim()) || [];

    // Check if registration is completely disabled
    if (process.env.DISABLE_REGISTRATION === 'true') {
      return { valid: false, error: 'Registro deshabilitado por el administrador' };
    }

    // Check invitation code
    if (invitationCode && validInvitationCodes.includes(invitationCode)) {
      return { valid: true };
    }

    // Check RUC whitelist
    if (ruc && allowedRUCs.includes(ruc)) {
      return { valid: true };
    }

    // If neither invitation code nor RUC whitelist, deny
    if (!invitationCode && allowedRUCs.length === 0) {
      return { valid: false, error: 'Código de invitación requerido' };
    }

    return { valid: false, error: 'Código de invitación inválido o RUC no autorizado' };
  }

  return { valid: true };
}

router.post('/register', async (req, res) => {
  const {
    email,
    password,
    // Company data
    ruc,
    razon_social,
    nombre_comercial,
    direccion,
    telefono,
    email: company_email,
    codigo_establecimiento,
    ultimo_secuencial,
    punto_emision,
    tipo_ambiente,
    tipo_emision,
    certificate,
    certificate_password,
    // Security
    masterKey,
    invitationCode,
  } = req.body;

  // Validate required fields
  if (!email || !password) {
    return res.status(400).json({ message: 'Email y contraseña son requeridos' });
  }

  if (!ruc || !razon_social) {
    return res.status(400).json({ message: 'RUC y razón social son requeridos' });
  }

  // Validate RUC format
  if (!isValidRUC(ruc)) {
    return res.status(400).json({ message: 'Formato de RUC inválido. Debe tener 13 dígitos y terminar en 001' });
  }

  // Validate certificate is provided
  if (!certificate) {
    return res.status(400).json({
      message: 'Certificado digital requerido. Debe enviar el archivo .p12 convertido a base64',
    });
  }

  // Validate certificate password
  if (!certificate_password) {
    return res.status(400).json({
      message: 'Contraseña del certificado requerida (certificate_password)',
    });
  }

  try {
    // Validate security requirements
    const securityCheck = await validateRegistrationSecurity(req);
    if (!securityCheck.valid) {
      return res.status(403).json({ message: securityCheck.error });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'Usuario ya existe' });
    }

    // Check if company already exists
    const existingCompany = await IssuingCompany.findOne({ ruc });
    if (existingCompany) {
      return res.status(409).json({ message: 'Empresa con este RUC ya está registrada' });
    }

    // Encrypt certificate password
    const encryptedPassword = encrypt(certificate_password);

    // Create user
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ email, password: hashedPassword });
    await user.save();

    // Create company
    const company = new IssuingCompany({
      ruc,
      razon_social,
      nombre_comercial: nombre_comercial || razon_social,
      direccion,
      telefono,
      email: company_email || email,
      codigo_establecimiento: codigo_establecimiento || '001',
      punto_emision: punto_emision || '001',
      ultimo_secuencial: ultimo_secuencial === undefined ? undefined : Number(ultimo_secuencial),
      tipo_ambiente: tipo_ambiente || 1,
      tipo_emision: tipo_emision || 1,
      certificate: certificate, // Certificado en base64 (se almacena tal cual)
      certificate_password: encryptedPassword,
      user_id: user._id,
    });
    await company.save();

    // Generate token
    const token = jwt.sign({ userId: user._id, companyId: company._id }, process.env.JWT_SECRET || '', {
      expiresIn: '4d',
    });

    return res.status(201).json({
      message: 'Usuario y empresa creados exitosamente',
      token,
      user: {
        id: user._id,
        email: user.email,
      },
      company: {
        id: company._id,
        ruc: company.ruc,
        razon_social: company.razon_social,
        nombre_comercial: company.nombre_comercial,
      },
    });
  } catch (err) {
    console.error('Error en registro:', err);
    return res.status(500).json({ message: 'Error del servidor' });
  }
});

router.post('/auth', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email y contraseña requeridos' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // Find associated company
    const company = await IssuingCompany.findOne({ user_id: user._id });

    const token = jwt.sign(
      {
        userId: user._id,
        companyId: company?._id,
      },
      process.env.JWT_SECRET || '',
      {
        expiresIn: '4d',
      },
    );

    return res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
      },
      company: company
        ? {
            id: company._id,
            ruc: company.ruc,
            razon_social: company.razon_social,
            nombre_comercial: company.nombre_comercial,
          }
        : null,
    });
  } catch (err) {
    console.error('Error en autenticación:', err);
    return res.status(500).json({ message: 'Error del servidor' });
  }
});

// Endpoint to check system status
router.get('/status', async (req, res) => {
  try {
    const isFirst = await isFirstRegistration();
    const registrationDisabled = process.env.DISABLE_REGISTRATION === 'true';

    return res.json({
      firstRegistration: isFirst,
      registrationDisabled,
      requiresInvitation: !isFirst && !registrationDisabled,
      masterKeyRequired: isFirst,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Error del servidor' });
  }
});

export default router;
