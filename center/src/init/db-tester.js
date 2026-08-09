import * as mysql from '../db/drivers/mysql.js';
import * as mssql from '../db/drivers/mssql.js';

const drivers = { mysql, mssql };

export async function testDbConnection(dbKind, dbConfig) {
  const m = drivers[dbKind];
  if (!m) return { ok: false, error: `Unsupported dbKind: ${dbKind}` };
  let driver;
  try {
    driver = await m.open(dbConfig);
    await m.query(driver, 'SELECT 1');
    await m.close(driver);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}