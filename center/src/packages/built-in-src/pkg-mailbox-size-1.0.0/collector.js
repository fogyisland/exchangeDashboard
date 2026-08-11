// Calls Get-MailboxStatistics via local Exchange Management Shell.
// PowerShell truncates large numbers; this is acceptable for monitoring (max 2^53).
export default {
  name: 'pkg-mailbox-size',
  async collect({ execFile }) {
    if (!execFile || process.platform !== 'win32') return [];
    const { execFile: ef } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const pexec = promisify(ef);
    const ps = `
      $ErrorActionPreference = 'SilentlyContinue'
      Get-MailboxStatistics -ResultSize Unlimited |
        Select-Object @{N='Identity';E={$_.DisplayName}},
                       @{N='Db';E={$_.DatabaseName.ToString()}},
                       @{N='SizeBytes';E={[int64]$_.TotalItemSize.Value.ToBytes()}},
                       @{N='Count';E={[int]$_.ItemCount}} |
        ConvertTo-Json -Compress
    `;
    let stdout;
    try {
      const r = await pexec('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
      stdout = r.stdout;
    } catch { return []; }
    let arr;
    try { arr = JSON.parse(stdout); } catch { return []; }
    if (!Array.isArray(arr)) arr = [arr];
    return arr
      .filter((m) => m && m.Identity)
      .map((m) => ({
        mailbox_identity: String(m.Identity).slice(0, 255),
        database: String(m.Db || '').slice(0, 128),
        total_item_size_bytes: Number(m.SizeBytes) || 0,
        item_count: Number(m.Count) || 0
      }));
  }
};