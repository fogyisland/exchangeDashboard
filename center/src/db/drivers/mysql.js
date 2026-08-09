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
  return { pool, kind: "mysql" };
}

export async function query(driver, sql, params = []) {
  const [rows] = await driver.pool.execute(sql, params);
  return rows;
}

export async function close(driver) {
  await driver.pool.end();
}
