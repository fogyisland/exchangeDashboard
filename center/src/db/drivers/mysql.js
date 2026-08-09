import mysql from "mysql2/promise";

export async function open(dbConfig) {
  const pool = mysql.createPool({
    host: dbConfig.host,
    port: Number(dbConfig.port) || 3306,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    waitForConnections: true,
    connectionLimit: 10,
    multipleStatements: false
  });
  return { pool, kind: "mysql", database: dbConfig.database };
}

export async function query(driver, sql, params = []) {
  // MySQL's prepared-statement protocol (used by execute()) rejects DDL like
  // CREATE TABLE / CREATE DATABASE. Fall back to the text protocol (query())
  // when no params are bound so DDL works without changing call sites.
  const fn = params && params.length > 0 ? driver.pool.execute : driver.pool.query;
  const [rows] = await fn.call(driver.pool, sql, params);
  return rows;
}

// Acquire a single dedicated connection. Required for operations that change
//   connection-local state (e.g. `USE <schema>`) — pooled connections would
//   scatter the state across pool members and lose it on the next acquire.
//   Caller MUST release() the connection when done.
export async function getConnection(driver) {
  const conn = await driver.pool.getConnection();
  return {
    raw: conn,
    query: (sql, params) => rawQuery(conn, sql, params),
    release: () => conn.release()
  };
}

async function rawQuery(conn, sql, params = []) {
  const fn = params && params.length > 0 ? conn.execute : conn.query;
  const [rows] = await fn.call(conn, sql, params);
  return rows;
}

export async function close(driver) {
  await driver.pool.end();
}
