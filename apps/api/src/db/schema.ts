import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const networks = pgTable('networks', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  submitter_name: varchar('submitter_name', { length: 100 }).notNull(),
  file_url: text('file_url').notNull(),
  neuron_count: integer('neuron_count').notNull(),
  synapse_count: integer('synapse_count').notNull(),
  tags: text('tags').array().notNull().default([]),
  run_count: integer('run_count').notNull().default(0),
  flagged: boolean('flagged').notNull().default(false),
  created_at: timestamp('created_at').notNull().defaultNow(),
})

export const runs = pgTable('runs', {
  id: varchar('id', { length: 36 }).primaryKey(),
  network_id: varchar('network_id', { length: 36 })
    .notNull()
    .references(() => networks.id, { onDelete: 'cascade' }),
  params_used: jsonb('params_used').notNull().default({}),
  timesteps: integer('timesteps').notNull(),
  spike_count: integer('spike_count').notNull(),
  ip_hash: varchar('ip_hash', { length: 64 }).notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
})

export const votes = pgTable('votes', {
  id: varchar('id', { length: 36 }).primaryKey(),
  network_id: varchar('network_id', { length: 36 })
    .notNull()
    .references(() => networks.id, { onDelete: 'cascade' }),
  ip_hash: varchar('ip_hash', { length: 64 }).notNull(),
  direction: varchar('direction', { length: 4 }).notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  // mirrors the UNIQUE constraint in 0001_initial.sql — required for onConflictDoUpdate
  networkIpUnique: uniqueIndex('votes_network_id_ip_hash_key').on(table.network_id, table.ip_hash),
}))

export type NetworkRow = typeof networks.$inferSelect
export type NewNetworkRow = typeof networks.$inferInsert
export type RunRow = typeof runs.$inferSelect
export type NewRunRow = typeof runs.$inferInsert
export type VoteRow = typeof votes.$inferSelect
export type NewVoteRow = typeof votes.$inferInsert
