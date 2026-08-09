import * as mysql from "./drivers/mysql.js";
import * as mssql from "./drivers/mssql.js";
const drivers = { mysql, mssql };

export async function init(dbConfig) {
  const driverMod = drivers[dbConfig.dbKind];
  if (!driverMod) throw new Error(`Unsupported dbKind: ${dbConfig.dbKind}`);
  const driver = await driverMod.open(dbConfig.db);
  return {
    driver,
    query: (sql, params) => driverMod.query(driver, sql, params),
    close: () => driverMod.close(driver)
  };
}

export async function close(ctx) {
  await ctx.close();
}
