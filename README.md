# GitHub Stats Cards

> Beautiful, self-hosted GitHub stats cards served as SVGs — powered by Vercel + GitHub GraphQL API.

![stats](https://githubstatscards.vercel.app/api?type=stats)
![langs](https://githubstatscards.vercel.app/api?type=langs)
![streak](https://githubstatscards.vercel.app/api?type=streak)

---

## Features

- **Stats card** — Stars, commits this year, total commits (all time), PRs, issues, contributions
- **Languages card** — Top 8 languages across all your repos with a color bar
- **Streak card** — Total contributions, current streak, longest streak
- Includes **private repo commits** (via your PAT)
- Username is **auto-derived from your token** — nothing to hardcode
- Zero npm dependencies — pure Node.js

---

## Deploy Your Own (2 steps)

### Step 1 — Fork & deploy to Vercel

1. Fork this repo
2. Go to [vercel.com](https://vercel.com) → **New Project** → import your forked repo
3. Click **Deploy** (no build settings needed)

### Step 2 — Add your GitHub token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)**
2. Give it these scopes:
   - `repo` (full) — for private commit counts
   - `read:user` — for profile data
3. Copy the token
4. In Vercel → your project → **Settings** → **Environment Variables**
5. Add: `PAT_1` = your token
6. Go to **Deployments** → click the 3 dots on the latest deploy → **Redeploy**

---

## Add to Your README

Replace `YOUR-VERCEL-URL` with your actual Vercel deployment URL:

```markdown
<div align="center">
  <img height="160" src="https://YOUR-VERCEL-URL/api?type=stats" />
  <img height="160" src="https://YOUR-VERCEL-URL/api?type=langs" />
</div>
<div align="center">

[![GitHub Streak](https://YOUR-VERCEL-URL/api?type=streak)](https://github.com/YOUR-USERNAME)

</div>
```

---

## Card URLs

| Card | URL |
|------|-----|
| Stats | `https://YOUR-VERCEL-URL/api?type=stats` |
| Languages | `https://YOUR-VERCEL-URL/api?type=langs` |
| Streak | `https://YOUR-VERCEL-URL/api?type=streak` |

---

## How it works

- On every request, the API calls `{ viewer { login } }` to identify the token owner
- Username is **always derived from the PAT** — you cannot display someone else's stats
- Private commits are included via `restrictedContributionsCount`
- Total all-time commits are calculated by summing every year since account creation
- Cards are cached for 1 hour on Vercel's edge network

---

## Credits

Built by [gauravsharansah](https://github.com/gauravsharansah)
