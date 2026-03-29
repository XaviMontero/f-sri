import { Router } from 'express';
import Client from '../models/Client';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const doc = new Client(req.body);
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/', async (_req, res) => {
  try {
    const docs = await Client.find();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await Client.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/docid/:identifacion', async (req, res) => {
  try {
    const doc = await Client.findOne({identificacion: req.params.identifacion});
    if (!doc) return res.status(404).json({ message: 'Not found'});
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error'})
  }
}),

router.put('/:id', async (req, res) => {
  try {
    const doc = await Client.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const doc = await Client.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
