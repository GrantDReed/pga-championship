import { createHash } from "crypto";
import { redis } from "./redis.js";

const hashPin = (pin) =>
  createHash("sha256").update(String(pin)).digest("hex");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Protect with a simple admin secret
  const { secret, pins, transfers, action } = req.body || {};
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Invalid admin secret" });
  }

  // Force-write transfers (used to record swaps after the window closes,
  // e.g. when a participant forgot to submit during the window).
  // Body shape: transfers: { "<teamId>": { out, outCost, in, inCost } } or null to clear.
  if (transfers && typeof transfers === "object") {
    const results = [];
    for (const [teamId, t] of Object.entries(transfers)) {
      if (t === null) {
        await redis.del(`transfer:${teamId}`);
        results.push({ teamId, status: "cleared" });
        continue;
      }
      if (!t.out || !t.in || t.outCost == null || t.inCost == null) {
        results.push({ teamId, status: "skipped", reason: "out, outCost, in, inCost all required" });
        continue;
      }
      const record = { out: t.out, outCost: t.outCost, in: t.in, inCost: t.inCost, ts: new Date().toISOString(), source: "admin" };
      await redis.set(`transfer:${teamId}`, JSON.stringify(record));
      results.push({ teamId, status: "set", transfer: record });
    }
    return res.status(200).json({ status: "transfers-written", results });
  }

  // Wipe rosters (and optionally PINs)
  if (action === "wipe") {
    const TEAM_IDS = [0, 1, 2, 3];
    for (const id of TEAM_IDS) {
      await redis.del(`roster:${id}`);
    }
    if (req.body.wipePins) {
      for (const id of TEAM_IDS) {
        await redis.del(`pin:${id}`);
      }
    }
    if (req.body.wipeTransfers) {
      for (const id of TEAM_IDS) {
        await redis.del(`transfer:${id}`);
      }
    }
    return res.status(200).json({ status: "wiped", rosters: true, pins: !!req.body.wipePins, transfers: !!req.body.wipeTransfers });
  }

  // Seed PINs — pins should be an object like { "0": "1234", "1": "5678", ... }
  if (!pins || typeof pins !== "object") {
    return res.status(400).json({ error: "pins object required, or use action:\"wipe\"" });
  }

  const results = [];
  for (const [teamId, pin] of Object.entries(pins)) {
    const hash = hashPin(pin);
    await redis.set(`pin:${teamId}`, hash);
    results.push({ teamId, status: "set" });
  }

  return res.status(200).json({ status: "seeded", results });
}
