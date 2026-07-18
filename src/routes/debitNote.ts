import { Router } from 'express';
import DebitNote from '../models/DebitNote';
import DebitNotePDF from '../models/DebitNotePDF';
import { DebitNoteService } from '../services/debit-note.service';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const doc = new DebitNote(req.body);
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/complete', async (req, res) => {
  try {
    if (!req.body.nota_debito) {
      return res.status(400).json({
        success: false,
        message: 'Debit note data is required',
      });
    }

    const resultado = await DebitNoteService.crearNotaDebitoCompleta(req.body.nota_debito);

    return res.status(201).json({
      success: true,
      data: resultado,
      xml: resultado.xml,
    });
  } catch (err: any) {
    // Errors that should return 400 (Bad Request)
    const validationErrors = [
      'Client not found',
      'Identification type not found',
      'Empresa emisora no encontrada',
      'Invalid date format',
      'Datos de nota de débito inválidos o incompletos',
    ];

    const isValidationError = validationErrors.some((error) => err.message.includes(error));

    if (isValidationError) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    // All other errors are server errors (500)
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

router.get('/', async (_req, res) => {
  try {
    const docs = await DebitNote.find();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await DebitNote.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const doc = await DebitNotePDF.findOne({ nota_debito_id: req.params.id });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const doc = await DebitNote.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await DebitNote.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
