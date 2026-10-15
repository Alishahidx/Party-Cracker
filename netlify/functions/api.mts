import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { eq, sql } from 'drizzle-orm';
import { getDatabase } from '../../db/index.js';
import { events, people } from '../../db/schema.js';

class RequestError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function photoStore() {
  return getStore({ name: process.env.CONTEXT === 'production' ? 'party-photos' : 'party-photos-preview', consistency: 'strong' });
}

function personResponse(person: typeof people.$inferSelect) {
  return { id: person.id, name: person.name, imageUrl: person.imageKey ? `/api/photos/${person.id}` : null };
}

function validateId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new RequestError('Invalid member ID.');
  }
  return value;
}

function validateDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RequestError('Choose a valid calendar date.');
  }
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 1900 || Number(value.slice(0, 4)) > 9998) {
    throw new RequestError('Choose a valid calendar date between 1900 and 9998.');
  }
  return value;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new RequestError('Send JSON data.', 415);
  }
  const body = await request.text();
  if (Buffer.byteLength(body) > 180000) throw new RequestError('The uploaded image is too large.', 413);
  try {
    const data: unknown = JSON.parse(body);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new RequestError('Send a valid JSON object.');
  }
}

export default async function handler(request: Request) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    const method = request.method;
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST, PUT, DELETE' } });
    }
    if (method !== 'GET') {
      const origin = request.headers.get('Origin');
      if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
        throw new RequestError('Cross-site changes are not allowed.', 403);
      }
    }

    if (path === '/api/tracker' && method === 'GET') {
      const db = getDatabase();
      const [roster, calendar] = await Promise.all([
        db.select().from(people).orderBy(people.name),
        db.select().from(events),
      ]);
      return json({
        roster: roster.map(personResponse),
        events: Object.fromEntries(calendar.map(event => [event.date, { personId: event.personId, status: event.status }])),
      });
    }

    if (path.startsWith('/api/photos/') && method === 'GET') {
      const id = validateId(path.slice('/api/photos/'.length));
      const db = getDatabase();
      const [person] = await db.select().from(people).where(eq(people.id, id));
      if (!person?.imageKey) throw new RequestError('Photo not found.', 404);
      const image = await photoStore().get(person.imageKey, { type: 'arrayBuffer' });
      if (!image) throw new RequestError('Photo not found.', 404);
      return new Response(image, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    }

    if (path === '/api/roster' && method === 'POST') {
      const body = await readBody(request);
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) {
        throw new RequestError('Enter a name between 1 and 100 characters.');
      }
      const id = crypto.randomUUID();
      let imageKey: string | null = null;
      if (body.image !== null && body.image !== undefined && body.image !== '') {
        if (typeof body.image !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(body.image)) {
          throw new RequestError('Upload a valid JPG, PNG, or WebP image.');
        }
        const image = Buffer.from(body.image.slice('data:image/jpeg;base64,'.length), 'base64');
        if (image.length < 4 || image.length > 128000 || image[0] !== 255 || image[1] !== 216 || image[2] !== 255 || image.at(-2) !== 255 || image.at(-1) !== 217) {
          throw new RequestError('The image could not be processed. Choose another file.');
        }
        imageKey = id;
        await photoStore().set(imageKey, new Uint8Array(image).buffer, { metadata: { contentType: 'image/jpeg' } });
      }
      try {
        const db = getDatabase();
        const [person] = await db.insert(people).values({ id, name: body.name.trim(), imageKey }).returning();
        return json(personResponse(person), 201);
      } catch (error) {
        if (imageKey) await photoStore().delete(imageKey).catch(() => undefined);
        throw error;
      }
    }

    if (path.startsWith('/api/roster/') && method === 'DELETE') {
      const id = validateId(path.slice('/api/roster/'.length));
      const db = getDatabase();
      const [removed] = await db.delete(people).where(eq(people.id, id)).returning();
      if (!removed) throw new RequestError('This member has already been removed.', 404);
      if (removed.imageKey) await photoStore().delete(removed.imageKey).catch(() => undefined);
      return json({ ok: true });
    }

    if (path === '/api/events' && method === 'PUT') {
      const body = await readBody(request);
      const date = validateDate(body.date);
      const personId = validateId(typeof body.personId === 'string' ? body.personId : '');
      if (typeof body.status !== 'string' || !['scheduled', 'postponed', 'cancelled'].includes(body.status)) {
        throw new RequestError('Choose a valid event status.');
      }
      const status = body.status;
      const recurringWeeks = body.recurringWeeks ?? 0;
      if (typeof recurringWeeks !== 'number' || ![0, 4, 8, 12, 52].includes(recurringWeeks)) {
        throw new RequestError('Choose a supported weekly repeat interval.');
      }
      const db = getDatabase();
      const [person] = await db.select({ id: people.id }).from(people).where(eq(people.id, personId));
      if (!person) throw new RequestError('This host is no longer on the roster. Choose another member.', 409);
      const rows = [{ date, personId, status }];
      const nextDate = new Date(`${date}T12:00:00Z`);
      for (let week = 1; week <= recurringWeeks; week++) {
        nextDate.setUTCDate(nextDate.getUTCDate() + 7);
        rows.push({ date: nextDate.toISOString().slice(0, 10), personId, status: 'scheduled' });
      }
      const saved = await db.insert(events).values(rows).onConflictDoUpdate({
        target: events.date,
        set: { personId: sql`excluded.person_id`, status: sql`excluded.status`, updatedAt: sql`now()` },
        setWhere: eq(events.date, date),
      }).returning();
      return json({ events: Object.fromEntries(saved.map(event => [event.date, { personId: event.personId, status: event.status }])) });
    }

    if (path.startsWith('/api/events/') && method === 'DELETE') {
      const date = validateDate(path.slice('/api/events/'.length));
      const db = getDatabase();
      await db.delete(events).where(eq(events.date, date));
      return json({ ok: true });
    }

    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    return json({ error: 'Party Tracker could not reach its storage. Please try again shortly.' }, 503);
  }
}

export const config: Config = { path: '/api/*' };
