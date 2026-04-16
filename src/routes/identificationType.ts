import { Router } from 'express';
import IdentificationType from '../models/IdentificationType';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const doc = new IdentificationType(req.body);
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/', async (_req, res) => {
  try {
    const docs = await IdentificationType.find();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await IdentificationType.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/code/:codigo', async (req, res) => {
  try {
    const doc = await IdentificationType.findOne({codigo: req.params.codigo});
    if (!doc) return res.status(404).json({ message: 'Not found'});
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error'})
  }
});

router.put('/:id', async (req, res) => {
  try {
    const doc = await IdentificationType.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await IdentificationType.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
