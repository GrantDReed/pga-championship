import { createHash } from "crypto";
import { redis } from "./redis.js";

const hashPin = (pin) =>
  createHash("sha256").update(String(pin)).digest("hex");

const TEAM_IDS = [0, 1, 2, 3];

// Editing windows (must match public/index.html). mode: "build" = initial
// pick (overwrites full roster); "swap" = one-swap transfer (writes transfer:* key).
const EDIT_WINDOWS = [
  { open: new Date("2026-01-01T00:00:00-05:00"), close: new Date("2026-05-14T06:45:00-04:00"), mode: "build" },
  // Post-R2 transfer window — close = first R3 tee time (8 AM ET placeholder).
  { open: new Date("2026-05-15T18:00:00-04:00"), close: new Date("2026-05-16T08:00:00-04:00"), mode: "swap" },
];
function activeWindow() {
  const now = new Date();
  return EDIT_WINDOWS.find(w => now >= w.open && now < w.close) || null;
}
// Transfers become publicly visible once any swap window has closed (= first R3 tee time passed).
function transfersRevealed() {
  const now = new Date();
  return EDIT_WINDOWS.some(w => w.mode === "swap" && now >= w.close);
}

// Rosters are public only once play begins (the first tee time).
const TOURNAMENT_START = new Date("2026-05-14T06:45:00-04:00");
function tournamentHasStarted() { return new Date() >= TOURNAMENT_START; }

// Duplicated here so the serverless function can validate independently of the frontend.
// When the real roster is set, update both here and in public/index.html.
const PRICE_TIERS = {
  4: ["Scottie Scheffler", "Rory McIlroy", "Matt Fitzpatrick", "Cameron Young", "Jon Rahm", "Xander Schauffele"],
  3: ["Ludvig Aberg", "Bryson DeChambeau", "Tommy Fleetwood", "Collin Morikawa", "Justin Rose", "Russell Henley", "Chris Gotterup", "Patrick Cantlay", "Tyrrell Hatton", "Hideki Matsuyama", "Justin Thomas", "Sam Burns", "Brooks Koepka", "Robert MacIntyre", "Viktor Hovland", "Si Woo Kim", "Jacob Bridgeman"],
  2: ["Akshay Bhatia", "Sungjae Im", "Jordan Spieth", "Maverick McNealy", "Shane Lowry", "Sepp Straka", "Min Woo Lee", "Joaquin Niemann", "Thomas Detry", "Nicolai Hojgaard", "Sahith Theegala", "Harris English", "Daniel Berger", "J.J. Spaun", "Patrick Reed", "Adam Scott", "Keegan Bradley", "Jason Day", "J.T. Poston", "Corey Conners", "Gary Woodland", "Cameron Smith", "Kurt Kitayama", "Ryan Fox", "Rickie Fowler", "Alex Fitzpatrick", "Kristoffer Reitan", "Matt McCarty", "Ben Griffin", "Michael Thorbjornsen", "Brian Harman", "Aaron Rai", "Ryan Gerard", "Nick Taylor", "Wyndham Clark", "Taylor Pendrith", "David Puig", "Marco Penge", "Alex Smalley", "Ryo Hisatsune", "Harry Hall", "Dustin Johnson"],
  1: ["Stewart Cink", "Tom McKibbin", "Brian Campbell", "Davis Riley", "Kazuki Higa", "Kota Kaneko", "Jordan Gumberg", "Andy Sullivan", "Adam Schenk", "Travis Smyth", "Joe Highsmith", "Elvis Smylie", "Bernd Wiesberger", "Adrien Saddier", "Sami Valimaki", "Jhonattan Vegas", "Emiliano Grillo", "Mikael Lindberg", "Andrew Putnam", "Daniel Brown", "Matti Schmid", "Aldrich Potgieter", "David Lipsky", "Chandler Blanchet", "Johnny Keefer", "Garrick Higgo", "Nico Echavarria", "Ian Holt", "Casey Jarvis", "William Mouw", "Ricky Castillo", "Austin Smotherman", "Patrick Rodgers", "Andrew Novak", "Max Greyserman", "Max McGreevy", "Billy Horschel", "Chris Kirk", "Steven Fisk", "John Parry", "Stephan Jaeger", "Christiaan Bezuidenhout", "Rasmus Neergaard-Petersen", "Rasmus Hojgaard", "Sudarshan Yellamaraju", "Rico Hoey", "Jayden Schaper", "Haotong Li", "Matt Wallace", "Denny McCarthy", "Angel Ayora", "Michael Kim", "Max Homa", "Pierceson Coody", "Bud Cauley", "Lucas Glover", "Michael Brennan", "Keith Mitchell", "Daniel Hillier", "Alex Noren", "Jordan Smith", "Sam Stevens", "Padraig Harrington", "Luke Donald", "Jimmy Walker", "Jason Dufner", "Shaun Micheel", "Y.E. Yang", "Martin Kaymer", "Brandt Snedeker", "Jesse Droemer", "Michael Block", "Michael Katrude", "Jared Jones", "Ryan Lenahan", "Ben Polland", "Garrett Sapp", "Ryan Vermeer", "Mark Geddes", "Timothy Wiseman", "Austin Hurt", "Paul McClure", "Derek Berg", "Bryce Fisher", "Chris Gabriele", "Francisco Bide", "Ben Kern", "Zach Haynes", "Tyler Collet", "Braden Shattuck", "Tom Hoge"],
};

function normalize(n) {
  // Map atomic non-ASCII letters that NFD won't decompose (\u00f8, \u00e6, \u0142, \u0111, \u00df, \u00f0).
  const mapped = n
    .replace(/\u00f8/g, "o").replace(/\u00d8/g, "O")
    .replace(/\u00e6/g, "ae").replace(/\u00c6/g, "AE")
    .replace(/\u0142/g, "l").replace(/\u0141/g, "L")
    .replace(/\u0111/g, "d").replace(/\u0110/g, "D")
    .replace(/\u00f0/g, "d").replace(/\u00d0/g, "D")
    .replace(/\u00df/g, "ss");
  return mapped.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, "").trim();
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

  // GET — return all rosters + transfers (each redacted appropriately)
  if (req.method === "GET") {
    const revealed = tournamentHasStarted();
    const revealTransfers = transfersRevealed();
    const teams = {};
    const transfers = {};
    for (const id of TEAM_IDS) {
      const raw = await redis.get(`roster:${id}`);
      const roster = raw ? JSON.parse(raw) : [];
      teams[id] = revealed ? roster : [];
      if (revealTransfers) {
        const tRaw = await redis.get(`transfer:${id}`);
        if (tRaw) transfers[id] = JSON.parse(tRaw);
      }
    }
    return res.status(200).json({ teams, transfers, revealed, transfersRevealed: revealTransfers });
  }

  // POST — save a roster (build mode) or record a swap (swap mode)
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });

  const window = activeWindow();
  if (!window) {
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

  // Standard validation runs in both modes (budget, tier caps, in-field, no dupes)
  const errors = validateRoster(players);
  if (errors.length > 0) {
    return res.status(400).json({ error: "Invalid roster", details: errors });
  }

  if (window.mode === "swap") {
    // Need an existing roster to diff against
    const storedRaw = await redis.get(`roster:${teamId}`);
    if (!storedRaw) {
      return res.status(400).json({ error: "You don't have a roster on file — initial picks are closed." });
    }
    const stored = JSON.parse(storedRaw);
    const storedByNorm = new Map(stored.map(p => [normalize(p.name), p]));
    const submittedByNorm = new Map(players.map(p => [normalize(p.name), p]));

    const removed = stored.filter(p => !submittedByNorm.has(normalize(p.name)));
    const added = players.filter(p => !storedByNorm.has(normalize(p.name)));

    if (removed.length === 0 && added.length === 0) {
      // Revert path — clear any existing swap
      await redis.del(`transfer:${teamId}`);
      return res.status(200).json({ status: "reverted", transfer: null });
    }
    if (removed.length !== 1 || added.length !== 1) {
      return res.status(400).json({ error: "Transfer window allows exactly one swap (change one player). Re-submit your original 4 to clear an existing swap." });
    }
    const out = removed[0], inP = added[0];
    if (inP.cost > out.cost) {
      return res.status(400).json({ error: `Swap-in player must be same or lower value (£${inP.cost}m > £${out.cost}m).` });
    }

    const transfer = { out: out.name, outCost: out.cost, in: inP.name, inCost: inP.cost, ts: new Date().toISOString() };
    await redis.set(`transfer:${teamId}`, JSON.stringify(transfer));
    return res.status(200).json({ status: "swapped", transfer });
  }

  // window.mode === "build"
  // Reject identical 4-player rosters already picked by another team
  const newKey = players.map((p) => normalize(p.name)).sort().join("|");
  for (const id of TEAM_IDS) {
    if (id === teamId) continue;
    const raw = await redis.get(`roster:${id}`);
    if (!raw) continue;
    const other = JSON.parse(raw);
    if (!Array.isArray(other) || other.length !== 4) continue;
    const otherKey = other.map((p) => normalize(p.name)).sort().join("|");
    if (otherKey === newKey) {
      return res.status(409).json({ error: "Another team has already picked this exact 4-player roster. Please change at least one player." });
    }
  }

  // Save
  await redis.set(`roster:${teamId}`, JSON.stringify(players));
  return res.status(200).json({ status: "saved", players });
}
