import Database, { type Database as DatabaseType } from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import * as schema from '../../db/schema.js'

type TestDb = {
  db: BetterSQLite3Database<typeof schema>
  sqlite: DatabaseType
}

export function createTestDb(): TestDb {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })

  createSchemaTables(sqlite)

  return { db, sqlite }
}

export function closeTestDb(sqlite: DatabaseType): void {
  sqlite.close()
}

/** Materialize the production schema in an isolated in-memory database. */
export function createSchemaTables(sqlite: DatabaseType): void {
  const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"'
  for (const table of Object.values(schema)) {
    if (!table || typeof table !== 'object') continue
    let config: ReturnType<typeof getTableConfig>
    try { config = getTableConfig(table as Parameters<typeof getTableConfig>[0]) } catch { continue }
    const columns = config.columns.map(column => {
      let definition = quote(column.name) + ' ' + column.getSQLType()
      if (column.primary) definition += ' PRIMARY KEY'
      if (column.notNull) definition += ' NOT NULL'
      if (column.isUnique) definition += ' UNIQUE'
      if (column.default !== undefined) {
        const value = column.default
        definition += ' DEFAULT ' + (typeof value === 'string' ? "'" + value.replaceAll("'", "''") + "'" : Number(value))
      }
      return definition
    })
    for (const key of config.primaryKeys) columns.push('PRIMARY KEY (' + key.columns.map(c => quote(c.name)).join(',') + ')')
    for (const key of config.foreignKeys) {
      const ref = key.reference()
      columns.push('FOREIGN KEY (' + ref.columns.map(c => quote(c.name)).join(',') + ') REFERENCES ' + quote(getTableConfig(ref.foreignTable).name) + '(' + ref.foreignColumns.map(c => quote(c.name)).join(',') + ') ON DELETE ' + (key.onDelete ?? 'NO ACTION'))
    }
    sqlite.exec('CREATE TABLE ' + quote(config.name) + '(' + columns.join(',') + ')')
  }
  sqlite.exec('CREATE VIRTUAL TABLE notes_fts USING fts5(title, content, note_id UNINDEXED, owner_id UNINDEXED)')
}
