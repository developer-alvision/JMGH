# Deploy to Vercel

Vercel serves the website. The Firebase project you configure in `js/firebase-config.js` provides authentication, Firestore live updates, Storage and the nine core server functions.

## Deploy this folder

```powershell
cd E:\jyothsna-maternity
npx vercel login
npx vercel link --yes
npx vercel deploy --prod --yes
```

The repository includes `vercel.json`: framework **Other**, install command `npm ci`, build command `npm run build`, output directory `dist`. No private Firebase credentials belong in Vercel environment variables. Firebase browser configuration is already in the app. Local demo seeding does not run during builds.

After Vercel returns the production URL, add its exact hostname to **Firebase Console → Authentication → Settings → Authorized domains** in your own Firebase project. Add any custom domain you connect, too. Then test staff login from the production URL.

## Deploy from a Git repository

Import the project in Vercel and use the same settings above. Keep `.runtime`, `node_modules`, `.emulator-data`, `.env` files, credentials and logs out of the repository/deployment. The `.vercelignore` file excludes local-only artifacts from CLI uploads. Only `dist` is published as the website.

## Prepared static archive

Run `npm run package:vercel` to generate `jmgh-hms-static.zip`. Extract it into its own folder, then run `npx vercel deploy --prod --yes` inside that folder. It contains the built public files and a static Vercel configuration, so it needs no build or dependency installation.

Firebase Hosting can continue serving its current URL. A Vercel frontend deployment does not redeploy Firebase rules or server functions.
