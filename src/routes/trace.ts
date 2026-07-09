import { Router } from "express";
import { store } from "../store.js";

export const trace = Router();

// GET /trace — last N receipt summaries (no plaintext, no content). Demo feed.
trace.get("/trace", (req, res) => {
  const n = Math.min(Number(req.query.n) || 50, 200);
  const summaries = store.list(n).map((b) => ({
    task_id: b.receipt.task_id,
    chosen_model: b.receipt.chosen_model,
    timestamp: b.receipt.timestamp,
  }));
  res.json({ receipts: summaries });
});

// GET /trace/:id — full stored bundle. The public verification surface.
trace.get("/trace/:id", (req, res) => {
  const bundle = store.get(req.params.id);
  if (!bundle) return res.status(404).json({ error: "not found (evicted or never existed)" });
  res.json(bundle);
});
