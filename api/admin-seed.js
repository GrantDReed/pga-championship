import { createHash } from "crypto";
import { redis } from "./redis.js";

const hashPin = (pin) =>
  createHash("sha256").update(String(pin)).digest("hex");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Protect with a simple admin secret
  const { secret, pins, action } = req.body || {};
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Invalid admin secret" });
  }

  // Wipe rosters (and optionally PINs)
  if (action === "wipe") {
    const TEAM_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (const id of TEAM_IDS) {
      await redis.del(`roster:${id}`);
    }
    if (req.body.wipePins) {
      for (const id of TEAM_IDS) {
        await redis.del(`pin:${id}`);
      }
    }
    return res.status(200).json({ status: "wiped", rosters: true, pins: !!req.body.wipePins });
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
