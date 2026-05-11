const isPgaChampionship = (event) => {
  const name = (event?.name || event?.shortName || "").toLowerCase();
  return name.includes("pga championship");
};

const SOURCES = [
  {
    name: "espn-leaderboard",
    url: "https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard",
    parse: (data) => {
      const competitors = [];
      for (const event of data?.events || []) {
        if (!isPgaChampionship(event)) continue;
        for (const comp of event?.competitions || []) {
          competitors.push(...(comp.competitors || []));
        }
      }
      return competitors.map((c) => {
        const scoreVal = c.score?.displayValue ?? c.score ?? null;
        let total = null;
        if (scoreVal === "E") total = 0;
        else if (typeof scoreVal === "number") total = scoreVal;
        else if (typeof scoreVal === "string") {
          const n = parseInt(scoreVal);
          if (!isNaN(n)) total = n;
        }
        const ls = c.linescores || [];
        return {
          name: c.athlete?.displayName || "",
          total,
          thru: c.status?.thru != null ? String(c.status.thru) : null,
          r1: ls[0]?.value ?? null,
          r2: ls[1]?.value ?? null,
          r3: ls[2]?.value ?? null,
          r4: ls[3]?.value ?? null,
          pos: c.status?.position?.displayName ?? null,
          status: c.status?.type?.description ?? null,
        };
      });
    },
  },
  {
    name: "espn-scoreboard",
    url: "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard",
    parse: (data) => {
      const competitors = [];
      for (const event of data?.events || []) {
        if (!isPgaChampionship(event)) continue;
        for (const comp of event?.competitions || []) {
          competitors.push(...(comp.competitors || []));
        }
      }
      return competitors.map((c) => {
        const scoreVal = c.score?.displayValue ?? c.score ?? null;
        let total = null;
        if (scoreVal === "E") total = 0;
        else if (typeof scoreVal === "number") total = scoreVal;
        else if (typeof scoreVal === "string") {
          const n = parseInt(scoreVal);
          if (!isNaN(n)) total = n;
        }
        const ls = c.linescores || [];
        return {
          name: c.athlete?.displayName || "",
          total,
          thru: c.status?.thru != null ? String(c.status.thru) : null,
          r1: ls[0]?.value ?? null,
          r2: ls[1]?.value ?? null,
          r3: ls[2]?.value ?? null,
          r4: ls[3]?.value ?? null,
          pos: c.status?.position?.displayName ?? null,
          status: c.status?.type?.description ?? null,
        };
      });
    },
  },
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");

  const errors = [];

  for (const source of SOURCES) {
    try {
      const response = await fetch(source.url, {
        headers: { "User-Agent": "PGAChampionshipFantasy/1.0" },
      });
      if (!response.ok) {
        errors.push(`${source.name}: HTTP ${response.status}`);
        continue;
      }
      const data = await response.json();
      const players = source.parse(data);
      if (players.length > 0) {
        return res.status(200).json({
          source: source.name,
          updated: new Date().toISOString(),
          playerCount: players.length,
          players,
        });
      }
      errors.push(`${source.name}: 0 players parsed`);
    } catch (e) {
      errors.push(`${source.name}: ${e.message}`);
    }
  }

  return res.status(200).json({
    status: "not-started",
    updated: new Date().toISOString(),
    playerCount: 0,
    players: [],
  });
}
