import { createHash } from "crypto";
import { redis } from "./redis.js";

const hashPin = (pin) =>
  createHash("sha256").update(String(pin)).digest("hex");

const TEAM_IDS = [0, 1, 2, 3];

// Editing windows (must match public/index.html)
const EDIT_WINDOWS = [
  { open: new Date("2026-01-01T00:00:00-05:00"), close: new Date("2026-05-14T07:00:00-04:00") },
  { open: new Date("2026-05-15T20:00:00-04:00"), close: new Date("2026-05-16T07:00:00-04:00") },
];
function isEditingAllowed() {
  const now = new Date();
  return EDIT_WINDOWS.some(w => now >= w.open && now < w.close);
}

// Rosters are public only once play begins (the first tee time).
const TOURNAMENT_START = new Date("2026-05-14T07:00:00-04:00");
function tournamentHasStarted() { return new Date() >= TOURNAMENT_START; }

// Duplicated here so the serverless function can validate independently of the frontend.
// When the real roster is set, update both here and in public/index.html.
const PRICE_TIERS = {
  4: ["Scottie Scheffler", "Rory McIlroy", "Matt Fitzpatrick", "Cameron Young", "Jon Rahm", "Xander Schauffele"],
  3: ["Ludvig Aberg", "Bryson DeChambeau", "Tommy Fleetwood", "Collin Morikawa", "Justin Rose", "Russell Henley", "Chris Gotterup", "Patrick Cantlay", "Tyrrell Hatton", "Hideki Matsuyama", "Justin Thomas", "Sam Burns", "Brooks Koepka", "Robert MacIntyre", "Viktor Hovland", "Si Woo Kim", "Jacob Bridgeman"],
  2: ["Akshay Bhatia", "Sungjae Im", "Jordan Spieth", "Maverick McNealy", "Shane Lowry", "Sepp Straka", "Min Woo Lee", "Jake Knapp", "Joaquin Niemann", "Thomas Detry", "Nicolai Hojgaard", "Sahith Theegala", "Harris English", "Daniel Berger", "J.J. Spaun", "Patrick Reed", "Adam Scott", "Keegan Bradley", "Jason Day", "J.T. Poston", "Corey Conners", "Gary Woodland", "Cameron Smith", "Kurt Kitayama", "Ryan Fox", "Rickie Fowler", "Alex Fitzpatrick", "Kristoffer Reitan", "Matt McCarty", "Ben Griffin", "Michael Thorbjornsen", "Brian Harman", "Aaron Rai", "Ryan Gerard", "Nick Taylor", "Wyndham Clark", "Taylor Pendrith", "David Puig", "Marco Penge", "Alex Smalley", "Ryo Hisatsune", "Alex Noren", "Rasmus Hojgaard", "Harry Hall"],
  1: ["Stewart Cink", "Tom McKibbin", "Brian Campbell", "Davis Riley", "Kazuki Higa", "Kota Kaneko", "Jordan Gumberg", "Andy Sullivan", "Adam Schenk", "Travis Smyth", "Joe Highsmith", "Elvis Smylie", "Bernd Wiesberger", "Adrien Saddier", "Sami Valimaki", "Jhonattan Vegas", "Emiliano Grillo", "Mikael Lindberg", "Andrew Putnam", "Daniel Brown", "Matti Schmid", "Aldrich Potgieter", "David Lipsky", "Chandler Blanchet", "Johnny Keefer", "Garrick Higgo", "Nico Echavarria", "Ian Holt", "Casey Jarvis", "William Mouw", "Ricky Castillo", "Austin Smotherman", "Patrick Rodgers", "Andrew Novak", "Max Greyserman", "Max McGreevy", "Billy Horschel", "Chris Kirk", "Steven Fisk", "John Parry", "Stephan Jaeger", "Christiaan Bezuidenhout", "Rasmus Neergaard-Petersen", "Sudarshan Yellamaraju", "Rico Hoey", "Jayden Schaper", "Haotong Li", "Matt Wallace", "Denny McCarthy", "Angel Ayora", "Michael Kim", "Max Homa", "Pierceson Coody", "Bud Cauley", "Lucas Glover", "Dustin Johnson", "Michael Brennan", "Keith Mitchell", "Daniel Hillier", "Jordan Smith", "Sam Stevens", "Padraig Harrington", "Luke Donald", "Jimmy Walker", "Jason Dufner", "Shaun Micheel", "Y.E. Yang", "Martin Kaymer", "Brandt Snedeker", "Jesse Droemer", "Michael Block", "Michael Katrude", "Jared Jones", "Ryan Lenahan", "Ben Polland", "Garrett Sapp", "Ryan Vermeer", "Mark Geddes", "Timothy Wiseman", "Austin Hurt", "Paul McClure", "Derek Berg", "Bryce Fisher", "Chris Gabriele", "Francisco Bide", "Ben Kern", "Zach Haynes", "Tyler Collet", "Braden Shattuck"],
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

  // GET — return all rosters (redacted until the tournament starts)
  if (req.method === "GET") {
    const revealed = tournamentHasStarted();
    const teams = {};
    for (const id of TEAM_IDS) {
      const raw = await redis.get(`roster:${id}`);
      const roster = raw ? JSON.parse(raw) : [];
      // Before play begins, expose only whether a team has picked — not who.
      teams[id] = revealed ? roster : [];
    }
    return res.status(200).json({ teams, revealed });
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
