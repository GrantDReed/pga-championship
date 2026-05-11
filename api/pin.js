import { createHash } from "crypto";
import { redis } from "./redis.js";

const hashPin = (pin) =>
  createHash("sha256").update(String(pin)).digest("hex");

const TEAM_IDS = [0, 1, 2];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { pin } = req.body || {};
  if (!pin) {
    return res.status(400).json({ error: "pin is required" });
  }

  const hash = hashPin(pin);

  // Scan all teams to find which PIN matches
  for (const id of TEAM_IDS) {
    const stored = await redis.get(`pin:${id}`);
    if (stored === hash) {
      return res.status(200).json({ status: "verified", teamId: id });
    }
  }

  return res.status(401).json({ status: "invalid" });
}
