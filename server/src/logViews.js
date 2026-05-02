function generatePlayerListHTML(players, pagination) {
  const { page, totalPages } = pagination;
  const prevLink = page > 1
    ? `<a href="/logs/list?page=${page - 1}" style="padding:10px 20px; background:#6c757d; color:white; border-radius:4px; text-decoration:none;">Previous</a>`
    : `<span style="color:#999;">Previous</span>`;
  const nextLink = page < totalPages
    ? `<a href="/logs/list?page=${page + 1}" style="padding:10px 20px; background:#007bff; color:white; border-radius:4px; text-decoration:none;">Next</a>`
    : `<span style="color:#999;">No more players</span>`;

  return `<html><head><title>Players</title><style>body{font-family:sans-serif;max-width:800px;margin:20px auto;background:#f4f4f4}.card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 5px rgba(0,0,0,0.1)}table{width:100%;border-collapse:collapse}th,td{padding:12px;text-align:left;border-bottom:1px solid #eee}a{color:#007bff;text-decoration:none}</style></head>
  <body><div class="card"><h2>Player Logs</h2><table><tr><th>Player ID</th><th>Sessions</th><th>Last Active</th><th>Action</th></tr>
  ${players.map((player) => `<tr><td>${escapeHtml(player.owner)}</td><td>${player.totalSessions}</td><td>${new Date(player.lastModified).toLocaleString()}</td><td><a href="/logs?owner=${encodeURIComponent(player.owner)}">View</a></td></tr>`).join('')}
  </table>
  <div style="margin-top:20px; display:flex; justify-content:space-between;">${prevLink}${nextLink}</div>
  </div><p><a href="/">Home</a></p></body></html>`;
}

function generateLogViewHTML(data) {
  return `<html><head><title>${escapeHtml(data.owner)}</title><style>body{font-family:sans-serif;margin:20px;background:#f9f9f9}.session{background:white;padding:15px;margin-bottom:15px;border-radius:8px;border-left:5px solid #007bff}.log{font-family:monospace;font-size:12px;padding:4px;border-bottom:1px solid #f0f0f0}.Error{color:red}.Warning{color:#856404;background:#fff3cd}</style></head>
  <body><h1>Logs: ${escapeHtml(data.owner)}</h1><a href="/logs/list">Back to List</a>
  ${data.sessions.map((session) => `
    <div class="session">
      <strong>Session: ${escapeHtml(session.sessionId)}</strong> (Received: ${new Date(session.receivedAt).toLocaleString()})
      <div style="margin-top:10px">
        ${renderLogGroups(session.logs)}
      </div>
    </div>
  `).join('')}
  </body></html>`;
}

function renderLogGroups(logGroups) {
  return Object.entries(logGroups || {}).map(([category, items]) => {
    return (Array.isArray(items) ? items : []).map((entry) => {
      const level = entry && entry.level ? String(entry.level) : '';
      const timestamp = entry && entry.timestamp ? String(entry.timestamp) : '';
      const message = entry && entry.message ? String(entry.message) : '';
      return `<div class="log ${escapeHtml(level)}">[${escapeHtml(timestamp)}] [${escapeHtml(category)}] ${escapeHtml(message)}</div>`;
    }).join('');
  }).join('');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  generateLogViewHTML,
  generatePlayerListHTML
};
