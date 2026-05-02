const URL = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

async function cmd(...args) {
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  return data.result;
}

export const redis = {
  get: (key) => cmd("GET", key),
  set: (key, value) => cmd("SET", key, value),
  del: (key) => cmd("DEL", key),
  keys: (pattern) => cmd("KEYS", pattern),
};
