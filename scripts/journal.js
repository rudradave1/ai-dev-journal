import axios from "axios";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const USER = process.env.GITHUB_USERNAME;
const CACHE_FILE = "cache.json";

const headers = {
  Accept: "application/vnd.github+json"
};

// ------------------
// FETCH EVENTS
// ------------------
async function fetchEvents() {
  const date = new Date().toISOString().split("T")[0];
  const url = `https://api.github.com/search/commits?q=author:${USER}+committer-date:>=${date}&per_page=100`;

  const searchHeaders = {
    ...headers,
    Accept: "application/vnd.github.cloak-preview"
  };

  const res = await axios.get(url, { headers: searchHeaders });
  return res.data.items || [];
}

// ------------------
// EXTRACT COMMITS
// ------------------
function extract(events) {
  const map = {};

  for (const item of events) {
    const repo = item.repository?.full_name;
    const msg = item.commit?.message?.trim();
    
    if (!repo || !msg) continue;

    if (!map[repo]) map[repo] = [];
    map[repo].push(msg);
  }

  return map;
}

// ------------------
// CACHE SAVE
// ------------------
function saveCache(map) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(map, null, 2));
}

// ------------------
// CACHE LOAD
// ------------------
function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) return {};
  return JSON.parse(fs.readFileSync(CACHE_FILE));
}

// ------------------
// FALLBACK SUMMARY
// ------------------
function fallback(map) {
  let out = "";

  for (const repo in map) {
    out += `**${repo}**\n`;
    map[repo].slice(0, 3).forEach(m => {
      out += `- ${m}\n`;
    });
    out += "\n";
  }

  return out || "- Minor development updates";
}

// ------------------
// AI SUMMARY
// ------------------
async function summarize(map) {
  const formatted = Object.entries(map)
    .map(([repo, commits]) => `${repo}:\n${commits.join("\n")}`)
    .join("\n\n");

  const prompt = `
You are summarizing a senior software engineer's daily work.

Rewrite commits into strong, professional engineering updates.

- Group by project
- Focus on impact
- Avoid generic phrases

Commits:
${formatted}
`;

  const res = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "openrouter/free",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return res.data.choices[0].message.content;
}

// ------------------
// UPDATE README
// ------------------
function update(summary) {
  const date = new Date().toISOString().split("T")[0];
  const marker = "<!-- JOURNAL_START -->";

  let readme = fs.readFileSync("README.md", "utf-8");

  if (readme.includes(`### ${date}`)) {
    console.log("Already updated today");
    return;
  }

  const entry = `### ${date}\n${summary.trim()}\n\n`;

  const parts = readme.split(marker);

  const updated =
    parts[0] + marker + "\n\n" + entry + (parts[1] || "");

  fs.writeFileSync("README.md", updated);
}

// ------------------
// MAIN
// ------------------
async function main() {
  let map = {};

  try {
    console.log("Fetching GitHub events...");
    const events = await fetchEvents();
    console.log("GitHub OK");

    map = extract(events);

    if (Object.keys(map).length > 0) {
      saveCache(map);
    }

  } catch (err) {
    console.log("GitHub failed → using cached data");
    map = loadCache();
  }

  if (Object.keys(map).length === 0) {
    console.log("No data available");
    update("- Minor development updates");
    return;
  }

  let summary;

  try {
    console.log("Calling OpenRouter...");
    summary = await summarize(map);
    console.log("OpenRouter OK");
  } catch {
    console.log("AI failed → fallback");
    summary = fallback(map);
  }

  update(summary);
}

main();