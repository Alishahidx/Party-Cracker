# Party Tracker

A shared party calendar with a member roster, optional profile photos, host assignments, scheduled/postponed/cancelled statuses, and weekly repeats.

## What changed

The original `index.html` was React source rather than an HTML page, and it depended on Firebase configuration supplied by a different hosting environment. The application now uses Vite to compile React and Tailwind CSS, Netlify Functions for its API, Netlify Database for the roster and calendar, and Netlify Blobs for profile photos. Firebase credentials are not required.

## Development

Install dependencies with `npm install`, then run `netlify dev --port 8889` using the Netlify CLI with this project linked to its Netlify site. Open `http://localhost:8889`; running Vite on its own does not emulate the API or storage services.

Use `npm run typecheck` to check the database schema and server-side code. The Netlify build configuration runs `npm run build` and publishes `dist`.

## Database and deployment

The schema is defined in `db/schema.ts`, and generated migrations are included in `netlify/database/migrations`. Netlify provisions the database and applies these migrations automatically during deployment. If a new preview branch has no database yet, its storage API is not available until its first deployment. No database credentials belong in the frontend or repository.

For later schema changes, check migration status with `netlify db status`, update the schema, and generate a named migration with `npx drizzle-kit generate --name describe_the_change`. Do not apply migrations manually.

Photos are resized in the browser and stored in Netlify Blobs. Production photos and non-production photos use separate stores. Names without photos display initials, without relying on an external avatar service.

## Shared access and behavior

This retains the original application's shared, public editing model: anyone with the site URL can view and change the roster and calendar. It is not a private or authenticated calendar. Deleting a member also removes that member's calendar assignments. Do not enter sensitive personal information.

The calendar refreshes shared data every 30 seconds and immediately after changes. Weekly repeats keep existing assignments on future dates rather than overwriting them. Dates are handled as calendar dates so they do not shift in time zones west of UTC. Existing Firebase records are not imported automatically.
