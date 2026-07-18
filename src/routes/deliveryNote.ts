import { Router } from 'express';
import DeliveryNote from '../models/DeliveryNote';
import DeliveryNotePDF from '../models/DeliveryNotePDF';
import { DeliveryNoteService } from '../services/delivery-note.service';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const doc = new DeliveryNote(req.body);
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/complete', async (req, res) => {
  try {
    if (!req.body.guia_remision) {
      return res.status(400).json({
        success: false,
        message: 'Delivery note data is required',
      });
    }

    const resultado = await DeliveryNoteService.crearGuiaRemisionCompleta(req.body.guia_remision);

    return res.status(201).json({
      success: true,
      data: resultado,
      xml: resultado.xml,
    });
  } catch (err: any) {
    // Errors that should return 400 (Bad Request)
    const validationErrors = [
      'Empresa emisora no encontrada',
      'Invalid date format',
      'Datos de guía de remisión inválidos o incompletos',
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
    const docs = await DeliveryNote.find();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await DeliveryNote.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const doc = await DeliveryNotePDF.findOne({ guia_remision_id: req.params.id });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const doc = await DeliveryNote.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await DeliveryNote.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
