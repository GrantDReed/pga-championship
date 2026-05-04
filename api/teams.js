import { createHash } from "crypto";
import { redis } from "./redis.js";

const hashPin = (pin) =>
  createHash("sha256").update(String(pin)).digest("hex");

const TEAM_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// Editing windows (must match public/index.html)
const EDIT_WINDOWS = [
  { open: new Date("2026-01-01T00:00:00-05:00"), close: new Date("2026-05-14T07:00:00-04:00") },
  { open: new Date("2026-05-15T20:00:00-04:00"), close: new Date("2026-05-16T07:00:00-04:00") },
];
function isEditingAllowed() {
  const now = new Date();
  return EDIT_WINDOWS.some(w => now >= w.open && now < w.close);
}

// Duplicated here so the serverless function can validate independently of the frontend.
// When the real roster is set, update both here and in public/index.html.
const PRICE_TIERS = {
  4: ["Scottie Scheffler", "Rory McIlroy", "Xander Schauffele", "Jon Rahm", "Ludvig Åberg", "Bryson DeChambeau"],
  3: ["Collin Morikawa", "Viktor Hovland", "Patrick Cantlay", "Tommy Fleetwood", "Shane Lowry", "Hideki Matsuyama", "Brooks Koepka", "Justin Thomas"],
  2: ["Robert MacIntyre", "Sungjae Im", "Tyrrell Hatton", "Jason Day", "Russell Henley", "Corey Conners", "Sepp Straka", "Adam Scott"],
  1: ["Keegan Bradley", "Wyndham Clark", "Brian Harman", "Tom McKibbin", "Aaron Rai", "Dustin Johnson", "Justin Rose", "Cameron Young"],
};

function normalize(n) {
  return n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, "").trim();
}

function getPlayerCost(name) {
  const norm = normalize(name);
  for (const [tier, names] of Object.entries(PRICE_TIERS)) {
    for (const n of names) {
      if (normalize(n) === norm) return parseInt(tier);
    }
  }
  return null;
}

function validateRoster(players) {
  const errors = [];
  if (!Array.isArray(players) || players.length !== 4) {
    errors.push("Must pick exactly 4 players");
    return errors;
  }

  const names = players.map((p) => normalize(p.name));
  if (new Set(names).size !== 4) errors.push("Duplicate players");

  for (const p of players) {
    const cost = getPlayerCost(p.name);
    if (cost === null) errors.push(`${p.name} is not in the field`);
    else if (cost !== p.cost) errors.push(`${p.name} cost mismatch`);
  }

  const budget = players.reduce((s, p) => s + p.cost, 0);
  if (budget > 10) errors.push(`Budget £${budget}m exceeds £10m`);

  const tier4 = players.filter((p) => p.cost === 4).length;
  if (tier4 > 1) errors.push(`Max 1 × £4m player (have ${tier4})`);

  const tier3 = players.filter((p) => p.cost === 3).length;
  if (tier3 > 2) errors.push(`Max 2 × £3m players (have ${tier3})`);

  return errors;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  // GET — return all rosters
  if (req.method === "GET") {
    const teams = {};
    for (const id of TEAM_IDS) {
      const raw = await redis.get(`roster:${id}`);
      teams[id] = raw ? JSON.parse(raw) : [];
    }
    return res.status(200).json({ teams });
  }

  // POST — save a roster
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });

  if (!isEditingAllowed()) {
    return res.status(403).json({ error: "Editing is currently locked." });
  }

  const { teamId, pin, players } = req.body || {};
  if (teamId == null || !pin || !players) {
    return res.status(400).json({ error: "teamId, pin, and players are required" });
  }
  if (!TEAM_IDS.includes(teamId)) {
    return res.status(400).json({ error: "Invalid teamId" });
  }

  // Verify PIN
  const storedHash = await redis.get(`pin:${teamId}`);
  if (!storedHash) {
    return res.status(401).json({ error: "PIN not set. Set your PIN first." });
  }
  if (storedHash !== hashPin(pin)) {
    return res.status(401).json({ error: "Invalid PIN" });
  }

  // Validate roster
  const errors = validateRoster(players);
  if (errors.length > 0) {
    return res.status(400).json({ error: "Invalid roster", details: errors });
  }

  // Save
  await redis.set(`roster:${teamId}`, JSON.stringify(players));
  return res.status(200).json({ status: "saved", players });
}
