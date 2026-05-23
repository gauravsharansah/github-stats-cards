// Username is derived from the PAT token automatically — no hardcoding needed

// ─── Palette ────────────────────────────────────────────────────────────────
const C = {
  bg:      "#0d1117",
  card:    "#161b22",
  border:  "#21262d",
  glow:    "#30363d",
  text:    "#e6edf3",
  muted:   "#7d8590",
  dim:     "#484f58",
  green:   "#3fb950",
  blue:    "#79c0ff",
  cyan:    "#39d353",
  orange:  "#ffa657",
  purple:  "#d2a8ff",
  red:     "#ff7b72",
  accent:  "#58a6ff",
  gold:    "#e3b341",
};

const LANG_COLORS = {
  "Jupyter Notebook": "#DA5B0B",
  JavaScript:  "#f1e05a",
  Python:      "#3572A5",
  HTML:        "#e34c26",
  CSS:         "#563d7c",
  "C++":       "#f34b7d",
  TypeScript:  "#3178c6",
  Java:        "#b07219",
  Go:          "#00ADD8",
  Rust:        "#dea584",
  Shell:       "#89e051",
  Ruby:        "#701516",
  PowerShell:  "#012456",
  Kotlin:      "#A97BFF",
  Swift:       "#F05138",
  Dart:        "#00B4AB",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function fmtDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric"});
}
function langColor(lang) {
  return LANG_COLORS[lang] ||
    `hsl(${Math.abs([...lang].reduce((a,c)=>a+c.charCodeAt(0),0)*37)%360},60%,55%)`;
}

// ─── GitHub GraphQL ───────────────────────────────────────────────────────────
async function gql(query, variables = {}) {
  const token = process.env.PAT_1;
  if (!token) throw new Error("PAT_1 environment variable is not set");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "github-stats-proxy",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json;
}

// ─── Fetch all contribution years to get accurate total commits ───────────────
async function fetchAllYearCommits(createdYear, GITHUB_USERNAME) {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = createdYear; y <= currentYear; y++) years.push(y);

  // Fetch each year's contributions in parallel
  const queries = years.map(y => `
    y${y}: user(login: "${GITHUB_USERNAME}") {
      contributionsCollection(
        from: "${y}-01-01T00:00:00Z"
        to:   "${Math.min(y, currentYear) === currentYear
                 ? new Date().toISOString()
                 : y + '-12-31T23:59:59Z'}"
      ) {
        totalCommitContributions
        restrictedContributionsCount
      }
    }
  `).join("\n");

  const { data } = await gql(`query { ${queries} }`);
  let total = 0;
  for (const key of Object.keys(data)) {
    const c = data[key].contributionsCollection;
    total += c.totalCommitContributions + c.restrictedContributionsCount;
  }
  return total;
}

// ─── Main data fetch ──────────────────────────────────────────────────────────
async function fetchData() {
  // Resolve who owns this token — username cannot be spoofed
  const token = process.env.PAT_1;
  if (!token) throw new Error("PAT_1 environment variable is not set");
  const viewerRes = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "github-stats-proxy" },
    body: JSON.stringify({ query: "{ viewer { login } }" }),
  });
  const viewerJson = await viewerRes.json();
  const GITHUB_USERNAME = viewerJson?.data?.viewer?.login;
  if (!GITHUB_USERNAME) throw new Error("Could not resolve GitHub username from token");

  // First fetch basic user info + current year contributions
  const { data } = await gql(`
    query($login: String!) {
      user(login: $login) {
        createdAt
        repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
          nodes {
            stargazerCount
            languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
              edges { size node { name } }
            }
          }
        }
        contributionsCollection {
          totalCommitContributions
          restrictedContributionsCount
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays { contributionCount date }
            }
          }
        }
        repositoriesContributedTo(
          first: 1
          contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]
        ) { totalCount }
        pullRequests(first: 1) { totalCount }
        issues(first: 1) { totalCount }
      }
    }
  `, { login: GITHUB_USERNAME });

  const user = data.user;
  const contrib = user.contributionsCollection;
  const createdYear = new Date(user.createdAt).getFullYear();

  // Stars + langs (include all repos: public + private owned)
  let totalStars = 0;
  let langMap = {};
  for (const repo of user.repositories.nodes) {
    totalStars += repo.stargazerCount;
    for (const edge of repo.languages.edges) {
      langMap[edge.node.name] = (langMap[edge.node.name] || 0) + edge.size;
    }
  }

  // Commits this year (rolling 12-month window, public + private)
  const commitsThisYear =
    contrib.totalCommitContributions + contrib.restrictedContributionsCount;

  // Total commits all time across all years
  const totalCommitsAllTime = await fetchAllYearCommits(createdYear, GITHUB_USERNAME);

  // ── Streak ────────────────────────────────────────────────────────────────
  const days = contrib.contributionCalendar.weeks.flatMap(w => w.contributionDays);
  const today = new Date().toISOString().split("T")[0];

  let currentStreak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].date > today) continue;
    if (days[i].contributionCount > 0) currentStreak++;
    else break;
  }

  let longest = 0, cur = 0, runStart = "", longestStart = "", longestEnd = "";
  for (const day of days) {
    if (day.contributionCount > 0) {
      if (cur === 0) runStart = day.date;
      cur++;
      if (cur > longest) {
        longest = cur; longestStart = runStart; longestEnd = day.date;
      }
    } else { cur = 0; }
  }

  return {
    totalStars, commitsThisYear, totalCommitsAllTime,
    totalPRs: user.pullRequests.totalCount,
    totalIssues: user.issues.totalCount,
    contributedTo: user.repositoriesContributedTo.totalCount,
    totalContributions: contrib.contributionCalendar.totalContributions,
    currentStreak, longestStreak: longest, longestStart, longestEnd,
    langMap, createdYear, username: GITHUB_USERNAME,
  };
}

// ─── STATS CARD ───────────────────────────────────────────────────────────────
function statsCard(d) {
  const W = 495, H = 230;

  const rows = [
    { icon: "★", color: C.gold,   label: "Total Stars Earned",        val: d.totalStars },
    { icon: "↑", color: C.green,  label: "Commits This Year",          val: d.commitsThisYear },
    { icon: "∑", color: C.cyan,   label: "Total Commits (all time)",   val: d.totalCommitsAllTime },
    { icon: "⌥", color: C.purple, label: "Total Pull Requests",        val: d.totalPRs },
    { icon: "◎", color: C.orange, label: "Total Issues",               val: d.totalIssues },
    { icon: "◈", color: C.accent, label: "Contributed To (last year)", val: d.contributedTo },
  ];

  const rowsSVG = rows.map(({ icon, color, label, val }, i) => {
    const y = 75 + i * 27;
    return `
    <rect x="18" y="${y - 13}" width="3" height="14" rx="1.5" fill="${color}" opacity="0.9"/>
    <text x="30" y="${y}" font-size="14" fill="${C.muted}" font-family="ui-monospace,SFMono-Regular,monospace">${esc(icon)}  ${esc(label)}</text>
    <text x="${W - 22}" y="${y}" font-size="14.5" fill="${C.text}" text-anchor="end" font-weight="700" font-family="ui-monospace,SFMono-Regular,monospace" letter-spacing="-0.3">${esc(val)}</text>`;
  }).join("\n");

  // Animated gradient border
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#161b22"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
    <linearGradient id="stitle" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${C.accent}"/>
      <stop offset="100%" stop-color="${C.cyan}"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" rx="14" fill="url(#sbg)"/>
  <!-- Border -->
  <rect width="${W}" height="${H}" rx="14" fill="none" stroke="${C.border}" stroke-width="1"/>
  <!-- Top accent line -->
  <rect x="0" y="0" width="${W}" height="3" rx="2" fill="url(#stitle)" opacity="0.8"/>

  <!-- Title -->
  <text x="22" y="40" font-size="17" font-weight="700" fill="url(#stitle)"
    font-family="ui-monospace,SFMono-Regular,monospace" filter="url(#glow)">${esc(d.username)}'s GitHub Stats</text>

  <!-- Divider -->
  <line x1="18" y1="54" x2="${W-18}" y2="54" stroke="${C.border}" stroke-width="1"/>

  ${rowsSVG}
</svg>`;
}

// ─── LANGS CARD ───────────────────────────────────────────────────────────────
function langsCard(d) {
  const W = 340, H = 230;
  const total = Object.values(d.langMap).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(d.langMap).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Progress bar
  let bx = 18;
  const barW = W - 36, barY = 62, barH = 10;
  const barSegs = sorted.map(([lang, size]) => {
    const w = Math.max(2, Math.round((size / total) * barW));
    const color = langColor(lang);
    const seg = `<rect x="${bx}" y="${barY}" width="${w}" height="${barH}" rx="0" fill="${color}"/>`;
    bx += w;
    return seg;
  }).join("\n");
  // Rounded caps
  const barCap = `
    <rect x="18" y="${barY}" width="6" height="${barH}" rx="4" fill="${langColor(sorted[0]?.[0]||'')}"/>
    <rect x="${W-24}" y="${barY}" width="6" height="${barH}" rx="4" fill="${langColor(sorted[sorted.length-1]?.[0]||'')}"/>`;

  // Legend: 2 columns
  const half = Math.ceil(sorted.length / 2);
  const legend = sorted.map(([lang, size], i) => {
    const col = i < half ? 0 : 1;
    const row = i < half ? i : i - half;
    const x = 18 + col * (W / 2 - 10);
    const y = 92 + row * 24;
    const pct = ((size / total) * 100).toFixed(1);
    const color = langColor(lang);
    const shortLang = lang.length > 14 ? lang.slice(0, 13) + "…" : lang;
    return `
    <circle cx="${x + 5}" cy="${y - 3}" r="4.5" fill="${color}"/>
    <text x="${x + 15}" y="${y}" font-size="12.5" fill="${C.muted}" font-family="ui-monospace,SFMono-Regular,monospace">${esc(shortLang)}</text>
    <text x="${x + (W/2 - 22)}" y="${y}" font-size="12.5" fill="${C.text}" text-anchor="end" font-weight="600" font-family="ui-monospace,SFMono-Regular,monospace">${esc(pct)}%</text>`;
  }).join("\n");

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="lbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#161b22"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
    <linearGradient id="ltitle" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${C.purple}"/>
      <stop offset="100%" stop-color="${C.accent}"/>
    </linearGradient>
    <clipPath id="barclip">
      <rect x="18" y="${barY}" width="${barW}" height="${barH}" rx="4.5"/>
    </clipPath>
  </defs>

  <rect width="${W}" height="${H}" rx="14" fill="url(#lbg)"/>
  <rect width="${W}" height="${H}" rx="14" fill="none" stroke="${C.border}" stroke-width="1"/>
  <rect x="0" y="0" width="${W}" height="3" rx="2" fill="url(#ltitle)" opacity="0.8"/>

  <text x="18" y="38" font-size="16" font-weight="700" fill="url(#ltitle)"
    font-family="ui-monospace,SFMono-Regular,monospace">Most Used Languages</text>
  <line x1="18" y1="52" x2="${W-18}" y2="52" stroke="${C.border}" stroke-width="1"/>

  <!-- Bar background -->
  <rect x="18" y="${barY}" width="${barW}" height="${barH}" rx="4.5" fill="${C.glow}"/>
  <!-- Bar segments clipped -->
  <g clip-path="url(#barclip)">${barSegs}${barCap}</g>

  ${legend}
</svg>`;
}

// ─── STREAK CARD ──────────────────────────────────────────────────────────────
function streakCard(d) {
  const { currentStreak, longestStreak, totalContributions, longestStart, longestEnd } = d;
  const W = 495, H = 230;
  const today = new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"});

  // Circle ring — always full, color shifts by streak length
  const cx = W / 2, cy = 118, r = 42;

  // Color ramp: 0=dim, 1-2=yellow, 3-6=orange, 7-13=red-orange, 14-29=red, 30+=deep red
  const streakColor =
    currentStreak === 0  ? C.dim :
    currentStreak <= 2   ? "#e3b341" :   // yellow
    currentStreak <= 6   ? "#f0883e" :   // orange
    currentStreak <= 13  ? "#f85149" :   // red-orange
    currentStreak <= 29  ? "#e0443a" :   // red
                           "#c0392b";    // deep red

  const streakColor2 =
    currentStreak === 0  ? C.border :
    currentStreak <= 2   ? "#ffd166" :   // bright yellow
    currentStreak <= 6   ? "#ffa657" :   // bright orange
    currentStreak <= 13  ? "#ff7b72" :   // bright red-orange
    currentStreak <= 29  ? "#ff6b6b" :   // bright red
                           "#ff4444";    // intense red

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="kbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#161b22"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
    <linearGradient id="ktitle" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${C.orange}"/>
      <stop offset="100%" stop-color="${C.gold}"/>
    </linearGradient>
    <linearGradient id="ringgrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="${streakColor2}"/>
      <stop offset="100%" stop-color="${streakColor}"/>
    </linearGradient>
    <filter id="rglow">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" rx="14" fill="url(#kbg)"/>
  <rect width="${W}" height="${H}" rx="14" fill="none" stroke="${C.border}" stroke-width="1"/>
  <rect x="0" y="0" width="${W}" height="3" rx="2" fill="url(#ktitle)" opacity="0.8"/>

  <!-- Title -->
  <text x="22" y="38" font-size="15" font-weight="700" fill="url(#ktitle)"
    font-family="ui-monospace,SFMono-Regular,monospace">Contribution Streak</text>
  <line x1="18" y1="50" x2="${W-18}" y2="50" stroke="${C.border}" stroke-width="1"/>

  <!-- LEFT: Total Contributions -->
  <text x="105" y="100" font-size="34" font-weight="800" fill="${C.accent}" text-anchor="middle"
    font-family="ui-monospace,SFMono-Regular,monospace" letter-spacing="-1">${esc(totalContributions)}</text>
  <text x="105" y="122" font-size="12" fill="${C.text}" text-anchor="middle"
    font-family="ui-monospace,SFMono-Regular,monospace">Total Contributions</text>
  <text x="105" y="138" font-size="10.5" fill="${C.muted}" text-anchor="middle"
    font-family="ui-monospace,SFMono-Regular,monospace">${esc(d.createdYear)} – Present</text>

  <!-- Dividers -->
  <line x1="178" y1="60" x2="178" y2="185" stroke="${C.border}" stroke-width="1"/>
  <line x1="${W-178}" y1="60" x2="${W-178}" y2="185" stroke="${C.border}" stroke-width="1"/>

  <!-- CENTER: Current streak ring -->
  <!-- Ring track -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.glow}" stroke-width="6"/>
  <!-- Ring progress -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
    stroke="url(#ringgrad)" stroke-width="6"
    stroke-dasharray="999"
    stroke-dashoffset="0"
    stroke-linecap="round"
    transform="rotate(-90 ${cx} ${cy})"
    filter="url(#rglow)"/>
  <!-- Flame emoji background glow -->
  <circle cx="${cx}" cy="${cy - r - 2}" r="8" fill="${C.bg}" opacity="0.8"/>
  <text x="${cx}" y="${cy - r + 5}" font-size="13" text-anchor="middle">🔥</text>
  <!-- Streak number -->
  <text x="${cx}" y="${cy + 8}" font-size="28" font-weight="800" fill="${streakColor}"
    text-anchor="middle" font-family="ui-monospace,SFMono-Regular,monospace"
    letter-spacing="-1">${esc(currentStreak)}</text>
  <text x="${cx}" y="${cy + r + 20}" font-size="12" font-weight="700" fill="${C.text}"
    text-anchor="middle" font-family="ui-monospace,SFMono-Regular,monospace">Current Streak</text>
  <text x="${cx}" y="${cy + r + 36}" font-size="10.5" fill="${C.muted}"
    text-anchor="middle" font-family="ui-monospace,SFMono-Regular,monospace">${esc(today)}</text>

  <!-- RIGHT: Longest streak -->
  <text x="${W - 105}" y="100" font-size="34" font-weight="800" fill="${C.accent}" text-anchor="middle"
    font-family="ui-monospace,SFMono-Regular,monospace" letter-spacing="-1">${esc(longestStreak)}</text>
  <text x="${W - 105}" y="122" font-size="12" fill="${C.text}" text-anchor="middle"
    font-family="ui-monospace,SFMono-Regular,monospace">Longest Streak</text>
  <text x="${W - 105}" y="138" font-size="10.5" fill="${C.muted}" text-anchor="middle"
    font-family="ui-monospace,SFMono-Regular,monospace">${esc(fmtDate(longestStart))} – ${esc(fmtDate(longestEnd))}</text>
</svg>`;
}

// ─── Error SVG ────────────────────────────────────────────────────────────────
function errorSVG(msg) {
  return `<svg width="495" height="80" viewBox="0 0 495 80" xmlns="http://www.w3.org/2000/svg">
  <rect width="495" height="80" rx="10" fill="#0d1117" stroke="#f85149" stroke-width="1"/>
  <text x="18" y="28" font-size="13" fill="#f85149" font-weight="700" font-family="monospace">⚠ Error</text>
  <text x="18" y="52" font-size="11" fill="#8b949e" font-family="monospace">${esc(String(msg).slice(0, 90))}</text>
</svg>`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
  res.setHeader("Content-Type", "image/svg+xml");

  const type = (req.query.type || "stats").toLowerCase();

  try {
    const data = await fetchData();
    let svg;
    if      (type === "stats")  svg = statsCard(data);
    else if (type === "langs")  svg = langsCard(data);
    else if (type === "streak") svg = streakCard(data);
    else return res.status(400).send(errorSVG("Unknown type. Use: stats | langs | streak"));
    res.status(200).send(svg);
  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).send(errorSVG(err.message));
  }
}