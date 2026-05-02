import axios from "axios";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const USER = process.env.GITHUB_USERNAME;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const OR_KEY = process.env.OPENROUTER_API_KEY;

const headers = {
  Authorization: `Bearer ${GH_TOKEN}`,
  Accept: "application/vnd.github+json"
};

// ------------------
// FETCH EVENTS
// ------------------
async function fetchEvents() {
  const res = await axios.get(
    `https://api.github.com/users/${USER}/events`,
    { headers }
  );
  return res.data.slice(0, 30);
}

// ------------------
// EXTRACT COMMITS
// ------------------
function extract(events) {
  const map = {};

  for (const e of events) {
    if (e.type !== "PushEvent") continue;

    const repo = e.repo.name;

    for (const c of e.payload.commits) {
      const msg = c.message.trim();

      if (
        msg.length < 5 ||
        msg.toLowerCase().includes("merge") ||
        msg.toLowerCase().includes("readme") ||
        msg.toLowerCase().includes("typo")
      ) continue;

      if (!map[repo]) map[repo] = [];
      map[repo].push(msg);
    }
  }

  return map;
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

  return out || "- Minor updates\n";
}

// ------------------
// AI SUMMARY
// ------------------
async function summarize(map) {
  const formatted = Object.entries(map)
    .map(([repo, commits]) => {
      return `${repo}:\n${commits.join("\n")}`;
    })
    .join("\n\n");

  const prompt = `
Summarize today's development work.

Group by project.
Be concise.
Focus on real work (features, fixes, improvements).

Commits:
${formatted}
`;

  const res = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "openrouter/auto",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4
    },
    {
      headers: {
        Authorization: `Bearer ${OR_KEY}`,
        "HTTP-Referer": `https://github.com/${USER}`,
        "X-Title": "AI Dev Journal"
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
  try {
    const events = await fetchEvents();
    const map = extract(events);

    if (Object.keys(map).length === 0) {
      console.log("No meaningful commits");
      return;
    }

    let summary;

    try {
      summary = await summarize(map);
    } catch (e) {
      console.log("AI failed → fallback");
      summary = fallback(map);
    }

    update(summary);
  } catch (err) {
    console.error("Error:", err.message);
  }
}

main();