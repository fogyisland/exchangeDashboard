import sql from "mssql";

export async function open(dbConfig) {
  const cfg = {
    user: dbConfig.user,
    password: dbConfig.password,
    server: dbConfig.host,
    port: Number(dbConfig.port) || 1433,
    database: dbConfig.database,
    options: { trustServerCertificate: dbConfig.trustServerCertificate ?? true }
  };
  const pool = await new sql.ConnectionPool(cfg).connect();
  return { pool, kind: "mssql" };
}

export async function query(driver, sqlText, params = []) {
  const req = driver.pool.request();
  const named = {};
  for (let i = 0; i < params.length; i++) {
    named[`p${i}`] = params[i];
    req.input(`p${i}`, params[i]);
  }
  // Replace each literal ? with @p0, @p1, ... in order.
  let i = 0;
  const rewritten = sqlText.replace(/\?/g, () => {
    const k = `p${i++}`;
    return `@${k}`;
  });
  const result = await req.query(rewritten);
  return result.recordset || [];
}

export async function close(driver) {
  await driver.pool.close();
}
