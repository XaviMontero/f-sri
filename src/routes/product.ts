import { Router } from 'express';
import Product from '../models/Product';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const doc = new Product(req.body);
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/', async (_req, res) => {
  try {
    const docs = await Product.find();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await Product.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/code/:codigo', async (req, res) => {
  try {
    const doc = await Product.findOne({ codigo: new String(req.params.codigo) });
    if (!doc) return res.status(404).json({ message: 'Not found'});
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error'});
  }
});

router.put('/:id', async (req, res) => {
  try {
    const doc = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await Product.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
