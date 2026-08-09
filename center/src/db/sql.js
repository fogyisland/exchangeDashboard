export function limit(dbKind, n) {
  return dbKind === "mssql" ? `TOP ${Number(n)}` : `LIMIT ${Number(n)}`;
}

export function now(dbKind) {
  return dbKind === "mssql" ? "GETDATE()" : "NOW()";
}

export function quoteIdent(name, dbKind) {
  if (dbKind === "mssql") {
    return "[" + String(name).replace(/]/g, "]]") + "]";
  }
  return "`" + String(name).replace(/`/g, "``") + "`";
}
