import { sql } from 'drizzle-orm';
import { check, date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const people = pgTable('people', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  imageKey: text('image_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable('events', {
  date: date('date', { mode: 'string' }).primaryKey(),
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('scheduled'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('events_status_check', sql`${table.status} in ('scheduled', 'postponed', 'cancelled')`),
]);
