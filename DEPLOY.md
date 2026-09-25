# Deploying mercury-ops (Vercel)

The app is a standard Next.js App Router project — Vercel auto-detects it (build `next build`, output handled automatically). The only non-default pieces are the **brand git submodule** and the **Airtable token**.

## ⚠️ Pushing to `main` does NOT deploy

This file used to end the line above with "every push to `main` auto-deploys". It does not, and
has not: every production deployment in the project's history was made from the CLI. Merging a PR
and walking away leaves the change **merged and not live**, with nothing anywhere saying so — a
security fix sat merged and unshipped for 15 minutes this way before anyone noticed (TK1220).
There is no GitHub deployment record and no commit status to check, because no Git integration is
posting one.

After merging, deploy by hand from a checkout of `main`:

```bash
cd mercury-ops
git checkout main && git pull        # deploy what is MERGED, not what you happen to have open
npx vercel --prod --yes              # ~30s; prints the deployment URL
npx vercel ls                        # newest row should read Ready / Production
```

**`vercel --prod` uploads this WORKING DIRECTORY, not the commit.** Anything you have open and
unsaved-to-git goes live with it, and anything on `main` you have not pulled does not. Check
`git status` and `git log origin/main -3` before you run it. Then curl something real — a `200`
from the home page only proves the old build is still up.

## One-time setup

### 1. Push both repos to the org
Vercel builds by cloning from GitHub, so the repos must exist there first. The brand is a submodule with a **relative** URL (`../mercury-brand`), so it resolves to `mercurytheclub/mercury-brand` only once both live under the same org.

```bash
# brand first (the submodule target)
cd mercury-brand
git remote add origin git@github.com:mercurytheclub/mercury-brand.git
git push -u origin main

# then ops
cd ../mercury-ops
git remote add origin git@github.com:mercurytheclub/mercury-ops.git
git push -u origin main
```
(Create the two empty repos under the `mercurytheclub` org first — via github.com/new or `gh repo create mercurytheclub/<name> --private`.)

### 2. Import into Vercel
1. vercel.com → **Add New… → Project** → import `mercurytheclub/mercury-ops`.
2. **Grant the Vercel GitHub app access to BOTH repos** (`mercury-ops` *and* `mercury-brand`). This is the step people miss — without access to the brand repo, the submodule checkout fails in CI and the build errors on the missing `vendor/brand` files.
3. Framework preset: **Next.js** (auto-detected). Root directory: repo root. Leave build/output settings default.

### 3. Set the environment variable
Project → **Settings → Environment Variables**:
- `AIRTABLE_TOKEN` = the Airtable read token (same one in `.env.local`). Scope: Production (and Preview if you want preview deploys to show data).

Then **Deploy**. The app comes up at `https://mercury-ops-<hash>.vercel.app` (add a custom domain later if wanted).

## Wire the Airtable interface link
Add a formula field to the Trips table (or the interface) that builds the per-trip URL:
```
"https://<your-vercel-domain>/trip/" & {Trip ID}
```
Clicking it opens that trip's full admin itinerary in ops.

## ⚠️ No access control yet
This deployment is **open** — anyone with the URL sees internal costs, supplier contacts, and guest PII. Gate it (Basic Auth middleware, or real team SSO) before sharing the link beyond a trusted few. Tracked as the next step.

## Updating the brand
The brand is pinned to a specific commit of the submodule. To pick up brand changes:
```bash
git -C vendor/brand pull origin main
git add vendor/brand && git commit -m "bump brand" && git push
```
Vercel redeploys with the new brand.

## Notes
- Node is pinned to 20 (`.nvmrc` + `engines`).
- The home page and `/trip/[tripCode]` are `force-dynamic` — they render per-request as Vercel serverless functions (reading Airtable live through the server-only loaders). No static caching of guest data.
